/**
 * Page Interaction Tools
 */

import { z } from 'zod';
import type { ChromeConnector } from '../chrome-connector.js';
import { humanDelay, waitFor, withTimeout } from '../utils/helpers.js';
import { truncateOutput } from '../utils/truncate.js';

export function createInteractionTools(connector: ChromeConnector) {
  return [
    // Consolidated Interaction Tool
    {
      name: 'perform_interaction',
      description:
        'Interact with page elements: click, type into inputs, select dropdown options, scroll, or wait for ' +
        'selector. Clicks/types use TRUSTED CDP input events by default (works on React/SPA where synthetic ' +
        'JS clicks are ignored); mode="synthetic" forces legacy JS events. Use get_html first to verify selectors.',
      inputSchema: z.object({
        action: z.enum(['click', 'type', 'select', 'scroll', 'wait']).describe('Action to perform'),
        selector: z.string().describe('CSS selector (Required for click, type, select, wait. Optional for scroll)'),
        text: z.string().optional().describe('Text to type (Required for action="type")'),
        value: z.string().optional().describe('Value to select (Required for action="select")'),
        coordinateX: z.number().default(0).describe('X coordinate for scroll'),
        coordinateY: z.number().default(0).describe('Y coordinate for scroll'),
        mode: z.enum(['auto', 'trusted', 'synthetic']).default('auto').describe('auto: trusted CDP input with synthetic fallback; trusted: CDP input only; synthetic: legacy JS events'),
        tabId: z.string().optional().describe('Tab ID (optional)'),
        timeoutMs: z.number().default(30000).describe('Timeout in milliseconds')
      }),
      handler: async ({ action, selector, text, value, coordinateX, coordinateY, mode = 'auto', tabId, timeoutMs = 30000 }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Runtime, DOM, Input } = client;

        await Runtime.enable();
        await DOM.enable();

        // 1. CLICK
        if (action === 'click') {
          if (!selector) throw new Error('Selector required for click');

          // JSON.stringify produces a fully-escaped JS string literal (quotes,
          // backslashes, unicode) — safer and simpler than hand-rolled escaping.
          const selectorLiteral = JSON.stringify(selector);

          // Wait for selector first
          const found = await waitFor(async () => {
            const result = await Runtime.evaluate({
              expression: `document.querySelector(${selectorLiteral}) !== null`
            });
            return result.result.value === true;
          }, timeoutMs);
          if (!found) throw new Error(`Selector not found: ${selector}`);

          await humanDelay(80, 200);

          // Trusted path: real CDP mouse events at the element's center.
          // Sites that ignore synthetic el.click() (React 17+, pointer-events
          // guards, overlays) still receive these. Falls back to synthetic.
          let trustedClicked = false;
          if (mode !== 'synthetic') {
            try {
              const box: any = await withTimeout(Runtime.evaluate({
                expression: `(() => {
                    const el = document.querySelector(${selectorLiteral});
                    if (!el) return null;
                    el.scrollIntoView({ block: 'center', inline: 'center' });
                    const r = el.getBoundingClientRect();
                    const cs = getComputedStyle(el);
                    const visible = r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none';
                    return { x: r.x, y: r.y, w: r.width, h: r.height, visible };
                })()`,
                returnByValue: true
              }), timeoutMs, 'Click bounding-box query timed out');

              const info = box.result?.value;
              if (info?.visible) {
                const x = Math.round(info.x + info.w / 2);
                const y = Math.round(info.y + info.h / 2);
                await Input.dispatchMouseEvent({ type: 'mouseMoved', x, y });
                await Input.dispatchMouseEvent({ type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
                await Input.dispatchMouseEvent({ type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
                trustedClicked = true;
              }
            } catch (e) {
              console.error('[perform_interaction] trusted click failed, falling back to synthetic:', (e as Error).message);
            }
          }

          if (trustedClicked) {
            await humanDelay();
            return { success: true, message: `Clicked ${selector} (trusted input)` };
          }

          // Synthetic fallback (mode="synthetic", invisible/overlaid elements,
          // or when the trusted path errored).
          const result: any = await withTimeout(Runtime.evaluate({
            expression: `
                    (function() {
                        const el = document.querySelector(${selectorLiteral});
                        if (!el) throw new Error('Element not found');
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        el.click();
                        return true;
                    })()
                `,
            awaitPromise: true
          }), timeoutMs, 'Click action timed out');

          if (result.exceptionDetails) {
            throw new Error(`Click failed: ${result.exceptionDetails.exception?.description}`);
          }
          await humanDelay();
          return { success: true, message: `Clicked ${selector}` };
        }

        // 2. TYPE
        if (action === 'type') {
          if (!selector) throw new Error('Selector required for type');
          if (text === undefined) throw new Error('Text required for type');

          const selectorLiteral = JSON.stringify(selector);

          // Focus + select existing content so trusted insertText replaces it.
          const focusResult: any = await Runtime.evaluate({
            expression: `(() => {
              const el = document.querySelector(${selectorLiteral});
              if (!el) return { ok: false };
              el.scrollIntoView({ block: 'center', inline: 'center' });
              el.focus();
              const tag = el.tagName.toLowerCase();
              if (tag === 'input' || tag === 'textarea') {
                el.select();
              } else {
                const sel = window.getSelection();
                if (sel) { sel.removeAllRanges(); const range = document.createRange(); range.selectNodeContents(el); sel.addRange(range); }
              }
              return { ok: true };
            })()`,
            returnByValue: true,
          });
          if (!focusResult.result?.value?.ok) throw new Error(`Selector not found: ${selector}`);

          // Trusted path: Input.insertText on the focused element (real key
          // events semantics, works with React/Vue controlled inputs).
          let typedTrusted = false;
          if (mode !== 'synthetic') {
            try {
              await withTimeout(client.Input.insertText({ text }), timeoutMs, 'Type (insertText) timed out');
              typedTrusted = true;
            } catch (e) {
              console.error('[perform_interaction] trusted insertText failed, falling back to synthetic:', (e as Error).message);
            }
          }

          if (!typedTrusted) {
            // Synthetic per-char fallback with bubbled input events.
            const script = `
                (async function() {
                    const el = document.querySelector(${selectorLiteral});
                    if (!el) throw new Error('Element not found');
                    el.focus();
                    el.value = "";
                    const text = ${JSON.stringify(text)};
                    for (let char of text) {
                        el.value += char;
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        await new Promise(r => setTimeout(r, Math.random() * 30 + 15));
                    }
                    return true;
                })()
            `;
            const result: any = await withTimeout(Runtime.evaluate({ expression: script, awaitPromise: true }), timeoutMs, 'Type action timed out');
            if (result.exceptionDetails) throw new Error(`Type failed: ${result.exceptionDetails.exception?.description}`);
          }

          // Unify with a bubbling change event so form listeners fire either way.
          await Runtime.evaluate({
            expression: `(() => { const el = document.querySelector(${selectorLiteral}); if (el) el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`,
          });
          await humanDelay();
          return { success: true, message: `Typed "${text}" into ${selector}${typedTrusted ? ' (trusted input)' : ''}` };
        }

        // 3. SELECT
        if (action === 'select') {
          if (!selector) throw new Error('Selector required for select');
          if (value === undefined) throw new Error('Value required for select');

          await Runtime.evaluate({
            expression: `
                    (function() {
                        const select = document.querySelector(${JSON.stringify(selector)});
                        if (!select) throw new Error('Select element not found');
                        select.value = ${JSON.stringify(value)};
                        select.dispatchEvent(new Event('change', { bubbles: true }));
                        return true;
                    })()
                `
          });
          await humanDelay();
          return { success: true, message: `Selected "${value}" in ${selector}` };
        }

        // 4. SCROLL
        if (action === 'scroll') {
          const scrollScript = selector
            ? `(function(){ const el = document.querySelector(${JSON.stringify(selector)}); if(el) el.scrollTo(${coordinateX}, ${coordinateY}); else window.scrollTo(${coordinateX}, ${coordinateY}); })()`
            : `window.scrollTo(${coordinateX}, ${coordinateY})`;
          await Runtime.evaluate({ expression: scrollScript });
          await humanDelay();
          return { success: true, message: `Scrolled to ${coordinateX},${coordinateY}` };
        }

        // 5. WAIT
        if (action === 'wait') {
          if (!selector) throw new Error('Selector required for wait');
          const found = await waitFor(async () => {
            const result = await Runtime.evaluate({
              expression: `document.querySelector(${JSON.stringify(selector)}) !== null`
            });
            return result.result.value === true;
          }, timeoutMs);
          if (!found) throw new Error(`Timeout waiting for ${selector}`);
          return { success: true, message: `Element found: ${selector}` };
        }

        throw new Error(`Unknown action: ${action}`);
      }
    },

    // Consolidated Extraction Tool
    {
      name: 'extract_element_data',
      description: 'Extract text content or HTML attributes from page elements using CSS selectors.',
      inputSchema: z.object({
        action: z.enum(['text', 'attribute']).describe('Extraction type'),
        selector: z.string().describe('CSS selector'),
        attributeName: z.string().optional().describe('Attribute name (Required for action="attribute")'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ action, selector, attributeName, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Runtime } = client;
        await Runtime.enable();

        if (action === 'text') {
          const result: any = await Runtime.evaluate({
            expression: `(function() { const el = document.querySelector(${JSON.stringify(selector)}); return el ? el.textContent.trim() : null; })()`
          });
          if (result.result.value === null) throw new Error(`Element not found: ${selector}`);
          return { success: true, text: result.result.value, selector };
        }

        if (action === 'attribute') {
          if (!attributeName) throw new Error('Attribute name required');
          const result: any = await Runtime.evaluate({
            expression: `(function() { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return {__notFound: true}; const v = el.getAttribute(${JSON.stringify(attributeName)}); return v === null ? {__nullAttr: true} : v; })()`,
            returnByValue: true
          });
          const val = result.result.value;
          if (val && val.__notFound) throw new Error(`Element not found: ${selector}`);
          return { success: true, value: val && val.__nullAttr ? null : val, selector, attribute: attributeName };
        }

        throw new Error(`Unknown action: ${action}`);
      }
    },

    // Execute JavaScript (Kept separate as it's a "Catch-all" for advanced usage)
    {
      name: 'execute_script',
      description: 'Execute JavaScript in the page context. Must include a return statement. Set awaitPromise=true for async code.',
      inputSchema: z.object({
        script: z.string().describe('JavaScript code to execute. MUST include "return" statement.'),
        tabId: z.string().optional().describe('Tab ID (optional)'),
        awaitPromise: z.boolean().default(false).describe('Wait for promise to resolve'),
        timeoutMs: z.number().default(30000).optional().describe('Timeout in milliseconds')
      }),
      handler: async ({ script, tabId, awaitPromise, timeoutMs = 30000 }: any) => {
        try {
          // Check if script is trying to replay network requests
          if (script.includes('fetch(') && (script.includes('POST') || script.includes('method:'))) {
            return {
              success: false,
              error: 'Use resend_network_request to replay captured packets, not execute_script+fetch()',
              suggestion: 'Workflow: capture_network_on_action → copy requestId → resend_network_request({ requestId })',
              hint: 'execute_script+fetch() breaks authentication and CORS. Use the official replay tools.'
            };
          }

          await connector.verifyConnection();
          const client = await connector.getTabClient(tabId);
          const { Runtime } = client;
          await Runtime.enable();

          const wrappedScript = `
            (function() {
              try {
                const result = (function() { ${script} })();
                if (result === undefined || result === null) return null;
                if (typeof result === 'function') return '[Function]';
                if (result instanceof Node || result instanceof Element) return '[DOM Node]';
                return result;
              } catch (e) { return { __error: true, message: e.message }; }
            })()
          `;

          const result = await withTimeout(Runtime.evaluate({
            expression: wrappedScript,
            awaitPromise,
            returnByValue: true,
            userGesture: true
          }), timeoutMs, `Script execution timed out`) as any;

          if (result.exceptionDetails) {
            return { success: false, error: result.exceptionDetails.exception?.description || 'Error' };
          }

          let resultValue = result.result.value;
          if (resultValue && resultValue.__error) {
            return { success: false, error: resultValue.message };
          }

          // Handle potentially large output
          let truncatedInfo = {};

          if (typeof resultValue === 'string' && resultValue.length > 50000) {
            const truncated = truncateOutput(resultValue, 50000, 'text');
            resultValue = truncated.data;
            truncatedInfo = {
              truncated: true,
              originalSize: truncated.totalSize,
              warning: 'Output truncated. Use get_html for large content or specific selectors.'
            };
          }

          return {
            success: true,
            result: resultValue,
            type: result.result.type,
            className: result.result.className,
            ...truncatedInfo
          };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      }
    }
  ];
}
