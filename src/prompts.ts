/**
 * MCP Prompts
 *
 * Pre-baked task templates that chain this server's own tools. A prompt
 * doesn't execute tools itself (MCP prompts just return a message list) —
 * the client inserts the returned text as a user turn, and the calling LLM
 * then autonomously invokes the referenced tools to carry it out.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

function userMessage(text: string) {
  return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] };
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'audit-accessibility',
    {
      title: 'Audit Accessibility',
      description: 'Runs an accessibility pass on a tab and reports concrete, WCAG-relevant issues (not a raw tree dump).',
      argsSchema: {
        tabId: z.string().optional().describe('Tab ID to audit (defaults to the current/first tab)'),
      },
    },
    ({ tabId }) =>
      userMessage(
        [
          `Audit the accessibility of ${tabId ? `tab ${tabId}` : 'the current tab'} using this MCP server's tools.`,
          '',
          'Steps:',
          '1. Call show_advanced_tools if get_accessibility_tree is not yet visible.',
          `2. Call get_accessibility_tree${tabId ? ` with tabId="${tabId}"` : ''} (includeIgnored=false).`,
          '3. Cross-check with get_html for: images without meaningful alt text, form inputs without an associated ' +
            'label, buttons/links with no accessible name, and heading order (h1 -> h2 -> h3 without skipping levels).',
          '4. For each issue: name the element (selector or role+name), what is wrong, why it matters for a screen ' +
            'reader / keyboard-only user, and a concrete fix.',
          '5. Summarize as a severity-ordered list (critical/serious/moderate/minor) — do not just dump the raw tree.',
        ].join('\n')
      )
  );

  server.registerPrompt(
    'debug-console-errors',
    {
      title: 'Debug Console Errors',
      description: 'Reads the browser console for a tab and helps diagnose the root cause of errors/exceptions.',
      argsSchema: {
        tabId: z.string().optional().describe('Tab ID to inspect (defaults to the current/first tab)'),
        reproSteps: z.string().optional().describe('What to do before reading logs, e.g. "click the submit button"'),
      },
    },
    ({ tabId, reproSteps }) =>
      userMessage(
        [
          `Debug JavaScript console errors on ${tabId ? `tab ${tabId}` : 'the current tab'}.`,
          '',
          'Steps:',
          reproSteps
            ? `1. Reproduce the issue first: ${reproSteps}.`
            : '1. If nothing has happened on the page yet, ask what action triggers the bug before proceeding.',
          `2. Call get_console_logs${tabId ? ` with tabId="${tabId}"` : ''} (level="all") to read buffered console output and exceptions.`,
          '3. For every "error"/"exception" entry, note the message, source file/line, and whether it repeats.',
          '4. If an error looks like a failed API call (404/500/CORS), cross-reference with ' +
            'show_captured_network_traffic / start_capturing_network_requests.',
          '5. Report the root cause (not just the symptom), which file/line to fix, and a concrete code-level suggestion.',
        ].join('\n')
      )
  );

  server.registerPrompt(
    'scrape-table',
    {
      title: 'Scrape Table',
      description: 'Extracts a table or repeating list from the page into clean structured rows.',
      argsSchema: {
        selector: z
          .string()
          .describe('CSS selector for the table or the repeating item container (e.g. "table.results", ".product-card")'),
        tabId: z.string().optional().describe('Tab ID to scrape (defaults to the current/first tab)'),
      },
    },
    ({ selector, tabId }) =>
      userMessage(
        [
          `Scrape structured data out of "${selector}"${tabId ? ` on tab ${tabId}` : ''} using this MCP server's tools.`,
          '',
          'Steps:',
          `1. Call get_html with selector="${selector}"${tabId ? `, tabId="${tabId}"` : ''} to see the actual markup — don't guess column names.`,
          '2. If it is a <table>: map <th> to column names and each <tr> to a row.',
          '   If it is a repeating list (cards/list items): infer a consistent field set from the first few items.',
          '3. If the HTML was truncated or the selector matches many repeated items, use execute_script with ' +
            'document.querySelectorAll(...) + Array.from(...).map(...) to extract just the needed fields as JSON, ' +
            'instead of dumping the full HTML.',
          '4. Return a JSON array of objects (one per row/item), plus the total row count found on the page ' +
            '(even if you only returned a sample).',
        ].join('\n')
      )
  );
}
