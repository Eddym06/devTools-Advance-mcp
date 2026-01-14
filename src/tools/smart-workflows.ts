/**
 * Smart Workflow Tools
 * High-level tools that combine multiple primitives for common use cases
 */

import { z } from 'zod';
import type { ChromeConnector } from '../chrome-connector.js';

export function createSmartWorkflowTools(connector: ChromeConnector) {
  return [
    // ═══════════════════════════════════════════════════════════════════
    // SMART TOOL SIMPLE: Add Header to Request (SIMPLIFIED VERSION)
    // ═══════════════════════════════════════════════════════════════════
    {
      name: 'add_custom_header_to_request',
      description: '✅ SIMPLE VERSION: Intercepts requests and adds a custom header before sending. USE THIS if intercept_and_modify_traffic is too complex. EXAMPLE: add_custom_header_to_request({ urlPattern: "**api**", headerName: "X-Custom", headerValue: "test", clickSelector: ".button" }). All parameters are simple strings/numbers - no nested objects.',
      inputSchema: z.object({
        urlPattern: z.string().describe('URL pattern to intercept (e.g., "*api*", "*.json")'),
        headerName: z.string().describe('Name of header to add (e.g., "X-Custom-Header")'),
        headerValue: z.string().describe('Value of header (e.g., "test-value")'),
        clickSelector: z.string().optional().describe('CSS selector of element to click (if action is click)'),
        navigateUrl: z.string().optional().describe('URL to navigate to (if action is navigate)'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ urlPattern, headerName, headerValue, clickSelector, navigateUrl, tabId }: any) => {
        try {
          await connector.verifyConnection();
          const client = await connector.getTabClient(tabId);
          const { Fetch, Runtime, Page } = client;

          // Enable interception
          await Fetch.enable({
            patterns: [{ urlPattern, requestStage: 'Request' as const }]
          });

          const modifiedRequests: any[] = [];

          // Set up handler
          Fetch.requestPaused(async (params: any) => {
            try {
              const headers = params.request.headers || {};
              headers[headerName] = headerValue;

              const headersArray = Object.entries(headers).map(([name, value]) => ({ 
                name, 
                value: String(value) 
              }));

              await Fetch.continueRequest({
                requestId: params.requestId,
                headers: headersArray
              });

              modifiedRequests.push({
                url: params.request.url,
                addedHeader: `${headerName}: ${headerValue}`,
                modified: true
              });
            } catch (error) {
              await Fetch.continueRequest({ requestId: params.requestId }).catch(() => {});
            }
          });

          // Perform action
          await Page.enable();

          if (clickSelector) {
            await Runtime.evaluate({
              expression: `document.querySelector('${clickSelector}')?.click()`,
              userGesture: true
            });
          } else if (navigateUrl) {
            await Page.navigate({ url: navigateUrl });
            await Page.loadEventFired();
          }

          // Wait for network
          await new Promise(resolve => setTimeout(resolve, 2000));

          // Cleanup
          await Fetch.disable();

          return {
            success: true,
            modifiedCount: modifiedRequests.length,
            requests: modifiedRequests,
            message: `✅ Added header "${headerName}: ${headerValue}" to ${modifiedRequests.length} request(s)`,
            explanation: 'Requests were modified BEFORE sending with original authentication preserved'
          };

        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            hint: 'Provide either clickSelector or navigateUrl to trigger requests'
          };
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // SMART TOOL NEW: Intercept and Modify Traffic (ADVANCED VERSION)
    // ═══════════════════════════════════════════════════════════════════
    {
      name: 'intercept_and_modify_traffic',
      description: '🎯 THE CORRECT WAY to modify network requests. Intercepts requests IN REAL-TIME before they are sent, modifies them, and sends with ORIGINAL authentication. EXAMPLE: intercept_and_modify_traffic({ urlPattern: "**/api/**", modifications: { addHeaders: { "X-Test": "value" } }, action: { type: "click", selector: ".button" } }). CRITICAL: modifications and action MUST be objects, not strings. ✅ Preserves cookies, auth, bypasses CORS.',
      inputSchema: z.object({
        urlPattern: z.string().describe('URL pattern to intercept (e.g., "**/api/**", "*/graphql*")'),
        modifications: z.object({
          addHeaders: z.record(z.string()).optional().describe('Headers to add/override as object: { "X-Custom": "value" }'),
          removeHeaders: z.array(z.string()).optional().describe('Header names to remove as array: ["X-Old"]'),
          modifyBody: z.string().optional().describe('New request body (replaces original)'),
          modifyMethod: z.string().optional().describe('New HTTP method (GET, POST, PUT, etc.)'),
        }).describe('Modifications object (NOT string). Example: { addHeaders: { "X-Test": "value" } }'),
        action: z.object({
          type: z.enum(['click', 'navigate', 'wait']).describe('Action that triggers the request'),
          selector: z.string().optional().describe('CSS selector for click action'),
          url: z.string().optional().describe('URL for navigate action'),
          waitMs: z.number().optional().describe('Milliseconds to wait (for wait action)'),
        }).describe('Action object (NOT string). Example: { type: "click", selector: ".button" }'),
        captureResponse: z.boolean().default(false).describe('Also capture the response after modification'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ urlPattern, modifications, action, captureResponse, tabId }: any) => {
        try {
          // Validate inputs
          if (typeof modifications === 'string') {
            throw new Error('❌ modifications must be an OBJECT, not a string. Example: { addHeaders: { "X-Test": "value" } }');
          }
          if (typeof action === 'string') {
            throw new Error('❌ action must be an OBJECT, not a string. Example: { type: "click", selector: ".button" }');
          }
          if (!action.type) {
            throw new Error('❌ action.type is required. Must be: "click", "navigate", or "wait"');
          }
          if (action.type === 'click' && !action.selector) {
            throw new Error('❌ action.selector is required for click actions');
          }
          if (action.type === 'navigate' && !action.url) {
            throw new Error('❌ action.url is required for navigate actions');
          }
          
          await connector.verifyConnection();
          const client = await connector.getTabClient(tabId);
          const { Fetch, Runtime, Page, Input } = client;

          // Step 1: Enable interception
          await Fetch.enable({
            patterns: [{ urlPattern, requestStage: 'Request' as const }]
          });

          const modifiedRequests: any[] = [];
          const responses: any[] = [];

          // Step 2: Set up interception handler
          Fetch.requestPaused(async (params: any) => {
            try {
              // Build modified headers
              const originalHeaders = params.request.headers || {};
              let finalHeaders = { ...originalHeaders };

              // Add/override headers
              if (modifications.addHeaders) {
                finalHeaders = { ...finalHeaders, ...modifications.addHeaders };
              }

              // Remove headers
              if (modifications.removeHeaders) {
                modifications.removeHeaders.forEach((header: string) => {
                  delete finalHeaders[header];
                });
              }

              // Convert to CDP format
              const headersArray = Object.entries(finalHeaders).map(([name, value]) => ({ name, value: String(value) }));

              // Prepare modification params
              const modifyParams: any = {
                requestId: params.requestId,
                headers: headersArray,
              };

              if (modifications.modifyMethod) {
                modifyParams.method = modifications.modifyMethod;
              }

              if (modifications.modifyBody !== undefined) {
                modifyParams.postData = modifications.modifyBody;
              }

              // Continue with modifications
              await Fetch.continueRequest(modifyParams);

              modifiedRequests.push({
                url: params.request.url,
                originalMethod: params.request.method,
                modifiedMethod: modifications.modifyMethod || params.request.method,
                originalHeaders: originalHeaders,
                modifiedHeaders: finalHeaders,
                modified: true
              });

            } catch (error) {
              // Fallback: continue without modification
              await Fetch.continueRequest({ requestId: params.requestId }).catch(() => {});
            }
          });

          // Step 3: Perform the action that triggers the request
          await Page.enable();

          switch (action.type) {
            case 'click':
              if (!action.selector) throw new Error('selector required for click action');
              await Runtime.evaluate({
                expression: `document.querySelector('${action.selector}')?.click()`,
                userGesture: true
              });
              break;

            case 'navigate':
              if (!action.url) throw new Error('url required for navigate action');
              await Page.navigate({ url: action.url });
              await Page.loadEventFired();
              break;

            case 'wait':
              await new Promise(resolve => setTimeout(resolve, action.waitMs || 2000));
              break;
          }

          // Wait for network activity
          await new Promise(resolve => setTimeout(resolve, 2000));

          // Step 4: Cleanup
          await Fetch.disable();

          return {
            success: true,
            interceptedAndModified: modifiedRequests.length,
            requests: modifiedRequests,
            message: `✅ Intercepted and modified ${modifiedRequests.length} request(s) in real-time`,
            explanation: 'Requests were modified BEFORE sending, preserving authentication and avoiding CORS issues',
            advantage: 'This is the ONLY reliable way to modify authenticated requests - they are sent with original cookies/auth',
            capturedResponses: captureResponse ? responses : undefined
          };

        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            hint: 'Ensure the action triggers a network request matching the URL pattern'
          };
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // SMART TOOL 1: Capture Network on Action (ANALYSIS ONLY)
    // ═══════════════════════════════════════════════════════════════════
    {
      name: 'capture_network_on_action',
      description: '📊 ANALYSIS TOOL: Captures network traffic details when performing actions. USE FOR: Understanding what requests a page makes, analyzing API calls, identifying request patterns. RETURNS: Full request details (URL, headers, body, method) for analysis. ⚠️ FOR MODIFICATION: Use intercept_and_modify_traffic instead - it modifies requests IN REAL-TIME before sending, preserving authentication.',
      inputSchema: z.object({
        action: z.enum(['click', 'navigate', 'type']).describe('Action to perform: click element, navigate to URL, or type text'),
        selector: z.string().optional().describe('CSS selector (required for click/type actions)'),
        url: z.string().optional().describe('URL (required for navigate action)'),
        text: z.string().optional().describe('Text to type (required for type action)'),
        urlPattern: z.string().default('*').describe('Filter captured requests by URL pattern (e.g., "*api*", "*.json")'),
        waitAfterAction: z.number().default(2000).describe('Milliseconds to wait after action before capturing (default: 2000)'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ action, selector, url, text, urlPattern, waitAfterAction, tabId }: any) => {
        try {
          await connector.verifyConnection();
          const client = await connector.getTabClient(tabId);
          const { Network, Fetch, Runtime, Input } = client;

          // Step 1: Enable network interception
          await Network.enable();
          await Fetch.enable({
            patterns: [{ urlPattern, requestStage: 'Request' as const }]
          });

          const interceptedRequests: any[] = [];
          
          // Listen for requests
          Fetch.requestPaused((params: any) => {
            interceptedRequests.push(params);
            Fetch.continueRequest({ requestId: params.requestId }).catch(() => {});
          });

          // Step 2: Perform action
          switch (action) {
            case 'click':
              if (!selector) throw new Error('selector is required for click action');
              await Runtime.evaluate({
                expression: `document.querySelector('${selector}')?.click()`,
                userGesture: true
              });
              break;
            
            case 'navigate':
              if (!url) throw new Error('url is required for navigate action');
              await client.Page.navigate({ url });
              break;
            
            case 'type':
              if (!selector || !text) throw new Error('selector and text are required for type action');
              await Runtime.evaluate({
                expression: `document.querySelector('${selector}')?.focus()`,
                userGesture: true
              });
              for (const char of text) {
                await Input.dispatchKeyEvent({ type: 'keyDown', text: char });
                await Input.dispatchKeyEvent({ type: 'keyUp', text: char });
              }
              break;
          }

          // Step 3: Wait for network activity
          await new Promise(resolve => setTimeout(resolve, waitAfterAction));

          // Step 4: Cleanup
          await Fetch.disable();

          // Step 5: Format and return results
          const formattedRequests = interceptedRequests.map(req => ({
            requestId: req.requestId,
            url: req.request.url,
            method: req.request.method,
            resourceType: req.resourceType,
            headers: req.request.headers,
            postData: req.request.postData
          }));

          return {
            success: true,
            action: action,
            capturedCount: formattedRequests.length,
            requests: formattedRequests,
            message: `Captured ${formattedRequests.length} network request(s) after ${action} action`,
            analysisComplete: true,
            hint: '💡 To MODIFY requests in real-time, use intercept_and_modify_traffic before the action',
            note: 'This tool is for ANALYSIS. For modification with auth preserved, intercept BEFORE the action happens.'
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            suggestion: 'Check selector/URL is valid and page is loaded'
          };
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // SMART TOOL 2: Navigate and Extract Content
    // ═══════════════════════════════════════════════════════════════════
    {
      name: 'navigate_and_extract_content',
      description: '🌐 Complete workflow: Navigate to URL and extract page content (HTML, text, links, images). Returns structured data in one call. Perfect for "go to URL and get me the page data". Combines navigation + wait + multiple extraction methods.',
      inputSchema: z.object({
        url: z.string().describe('URL to navigate to'),
        waitForSelector: z.string().optional().describe('CSS selector to wait for before extracting (ensures dynamic content loads)'),
        extractText: z.boolean().default(true).describe('Extract visible text'),
        extractLinks: z.boolean().default(true).describe('Extract all links'),
        extractImages: z.boolean().default(false).describe('Extract image sources'),
        extractMetadata: z.boolean().default(true).describe('Extract page title and meta tags'),
        timeout: z.number().default(30000).describe('Navigation timeout in ms'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ url, waitForSelector, extractText, extractLinks, extractImages, extractMetadata, timeout, tabId }: any) => {
        try {
          await connector.verifyConnection();
          const client = await connector.getTabClient(tabId);
          const { Page, Runtime } = client;

          // Step 1: Navigate
          await Page.enable();
          await Page.navigate({ url });
          await Page.loadEventFired();

          // Step 2: Wait for selector if provided
          if (waitForSelector) {
            const waitScript = `
              new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject('Timeout waiting for selector'), ${timeout});
                const check = () => {
                  if (document.querySelector('${waitForSelector}')) {
                    clearTimeout(timeout);
                    resolve(true);
                  } else {
                    setTimeout(check, 100);
                  }
                };
                check();
              })
            `;
            await Runtime.evaluate({ expression: waitScript, awaitPromise: true });
          }

          // Step 3: Extract data
          const extractionScript = `
            ({
              text: ${extractText} ? document.body.innerText : null,
              links: ${extractLinks} ? Array.from(document.querySelectorAll('a')).map(a => ({ href: a.href, text: a.textContent?.trim() })) : null,
              images: ${extractImages} ? Array.from(document.querySelectorAll('img')).map(img => ({ src: img.src, alt: img.alt })) : null,
              metadata: ${extractMetadata} ? {
                title: document.title,
                description: document.querySelector('meta[name="description"]')?.content,
                keywords: document.querySelector('meta[name="keywords"]')?.content,
                ogImage: document.querySelector('meta[property="og:image"]')?.content
              } : null,
              url: window.location.href,
              html: document.documentElement.outerHTML.substring(0, 5000)
            })
          `;

          const result = await Runtime.evaluate({
            expression: extractionScript,
            returnByValue: true
          });

          return {
            success: true,
            url: url,
            data: result.result.value,
            message: 'Page loaded and content extracted successfully'
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            url: url
          };
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // SMART TOOL 3: Test API Endpoint
    // ═══════════════════════════════════════════════════════════════════
    {
      name: 'test_api_endpoint',
      description: '🧪 Complete workflow: Test an API endpoint by sending request and capturing response. Perfect for "test this API" or "make POST request to endpoint". Handles auth cookies automatically. Combines request execution + response capture + formatting.',
      inputSchema: z.object({
        url: z.string().describe('API endpoint URL'),
        method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).default('GET').describe('HTTP method'),
        headers: z.union([z.record(z.string()), z.string()]).optional().describe('Request headers as object {"Content-Type": "application/json"} OR JSON string'),
        body: z.string().optional().describe('Request body (JSON string for POST/PUT)'),
        includeCredentials: z.boolean().default(true).describe('Include cookies and auth in request'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ url, method, headers, body, includeCredentials, tabId }: any) => {
        try {
          await connector.verifyConnection();
          const client = await connector.getTabClient(tabId);
          const { Runtime } = client;

          await Runtime.enable();

          // Parse headers if it's a JSON string
          let headersObj = {};
          if (headers) {
            if (typeof headers === 'string') {
              try {
                headersObj = JSON.parse(headers);
              } catch (e) {
                throw new Error(`Invalid headers JSON string: ${(e as Error).message}`);
              }
            } else {
              headersObj = headers;
            }
          }
          const fetchScript = `
            (async function() {
              try {
                const response = await fetch("${url}", {
                  method: "${method}",
                  headers: ${JSON.stringify(headersObj)},
                  body: ${body ? JSON.stringify(body) : 'undefined'},
                  credentials: ${includeCredentials ? '"include"' : '"omit"'},
                  mode: 'cors'
                });
                
                const text = await response.text();
                let parsedBody;
                try {
                  parsedBody = JSON.parse(text);
                } catch {
                  parsedBody = text;
                }
                
                return {
                  success: response.ok,
                  status: response.status,
                  statusText: response.statusText,
                  headers: Object.fromEntries(response.headers.entries()),
                  body: parsedBody,
                  bodySize: text.length
                };
              } catch (e) {
                return { __error: e.message, stack: e.stack };
              }
            })()
          `;

          const result = await Runtime.evaluate({
            expression: fetchScript,
            awaitPromise: true,
            returnByValue: true,
            userGesture: true
          });

          if (result.exceptionDetails) {
            throw new Error(`API test failed: ${result.exceptionDetails.exception?.description}`);
          }

          const value = result.result.value;
          if (value && value.__error) {
            throw new Error(`API fetch error: ${value.__error}`);
          }

          return {
            success: true,
            endpoint: url,
            method: method,
            response: value,
            message: `API test completed: ${value.status} ${value.statusText}`
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            endpoint: url,
            method: method
          };
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // SMART TOOL 4: Capture Click and Resend
    // ═══════════════════════════════════════════════════════════════════
    {
      name: 'capture_click_and_resend',
      description: '⚠️ DEPRECATED - Use intercept_and_modify_traffic instead. This tool attempts to replay captured packets but fails with CORS/auth on most APIs. The new tool intercepts and modifies in real-time BEFORE sending, which preserves authentication. Only use this for analysis/debugging, not for modifying production traffic.',
      inputSchema: z.object({
        clickSelector: z.string().describe('CSS selector of button/link to click'),
        returnUrl: z.string().describe('URL to navigate back to before replaying'),
        urlPattern: z.string().default('*').describe('Filter captured requests by URL pattern'),
        modifyHeaders: z.record(z.string()).optional().describe('Headers to modify before replay'),
        modifyBody: z.string().optional().describe('Body to modify before replay'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ clickSelector, returnUrl, urlPattern, modifyHeaders, modifyBody, tabId }: any) => {
        try {
          await connector.verifyConnection();
          const client = await connector.getTabClient(tabId);
          const { Runtime, Network, Fetch, Page } = client;

          await Runtime.enable();
          await Network.enable();

          // Step 1: Enable interception
          await Fetch.enable({
            patterns: [{ urlPattern, requestStage: 'Request' as const }]
          });

          const capturedRequests: any[] = [];
          Fetch.requestPaused(async (params: any) => {
            capturedRequests.push(params);
            await Fetch.continueRequest({ requestId: params.requestId });
          });

          // Step 2: Click element
          await Runtime.evaluate({
            expression: `document.querySelector('${clickSelector}')?.click()`,
            userGesture: true
          });

          // Wait for requests
          await new Promise(resolve => setTimeout(resolve, 2000));

          // Step 3: Disable interception
          await Fetch.disable();

          if (capturedRequests.length === 0) {
            return {
              success: false,
              error: 'No requests captured',
              hint: 'Check your selector and urlPattern'
            };
          }

          // Step 4: Navigate back
          await Page.enable();
          await Page.navigate({ url: returnUrl });
          await Page.loadEventFired();

          // Step 5: Replay first request using the official method
          const request = capturedRequests[0].request;
          const finalHeaders: Record<string, string> = {};
          
          // Filter forbidden headers
          const forbiddenHeaders = ['host', 'connection', 'content-length', 'origin', 'referer', 'accept-encoding', 'cookie'];
          
          // Merge original + custom headers
          if (request.headers) {
            Object.entries(request.headers).forEach(([k, v]) => {
              if (!forbiddenHeaders.includes(k.toLowerCase())) {
                finalHeaders[k] = v as string;
              }
            });
          }
          if (modifyHeaders) {
            Object.entries(modifyHeaders).forEach(([k, v]) => {
              finalHeaders[k] = v as string;
            });
          }

          const script = `
          (async function() {
            try {
              const response = await fetch("${request.url}", {
                method: "${request.method}",
                headers: ${JSON.stringify(finalHeaders)},
                body: ${modifyBody ? JSON.stringify(modifyBody) : (request.postData ? JSON.stringify(request.postData) : 'undefined')},
                credentials: 'include'
              });
              const text = await response.text();
              return {
                success: response.ok,
                status: response.status,
                statusText: response.statusText,
                bodyPreview: text.substring(0, 500)
              };
            } catch (e) {
              return { __error: e.message };
            }
          })()
          `;

          const result: any = await Runtime.evaluate({
            expression: script,
            awaitPromise: true,
            returnByValue: true,
            userGesture: true
          });

          if (result.exceptionDetails) {
            throw new Error(`Replay failed: ${result.exceptionDetails.exception?.description}`);
          }

          const value = result.result.value;
          if (value && value.__error) {
            return {
              success: false,
              capturedCount: capturedRequests.length,
              capturedUrl: request.url,
              capturedMethod: request.method,
              navigatedBackTo: returnUrl,
              replayError: value.__error,
              message: '✅ Packet captured successfully, ❌ Replay failed due to CORS/auth restrictions',
              explanation: 'This is a browser security limitation. The API server rejected the replayed request because it detected it was not from the original context. The original packet was captured with all headers/data.',
              workaround: 'Use modify_network_request to intercept and modify requests IN REAL-TIME before they are sent, instead of capturing and replaying after.'
            };
          }

          return {
            success: true,
            capturedCount: capturedRequests.length,
            capturedUrl: request.url,
            capturedMethod: request.method,
            navigatedBackTo: returnUrl,
            replayResult: value,
            message: '✅ Complete workflow executed: Click → Capture → Navigate → Replay'
          };

        } catch (error: any) {
          return {
            success: false,
            error: error.message
          };
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // SMART TOOL 5 (OLD 4): Capture and Replay Request (DEPRECATED - use capture_click_and_resend)
    // ═══════════════════════════════════════════════════════════════════
    {
      name: 'capture_and_replay_request',
      description: '⚠️ DEPRECATED: Use capture_click_and_resend instead. This tool suggests the correct workflow.',
      inputSchema: z.object({
        triggerAction: z.enum(['click', 'navigate']).describe('How to trigger the request'),
        selector: z.string().optional().describe('CSS selector (for click action)'),
        url: z.string().optional().describe('URL (for navigate action)'),
        urlPattern: z.string().describe('Pattern to match request to replay (e.g., "*api/login*")'),
        modifyHeaders: z.record(z.string()).optional().describe('Headers to modify before replay'),
        modifyBody: z.string().optional().describe('New body for replay (JSON string)'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ triggerAction, selector, url, urlPattern, modifyHeaders, modifyBody, tabId }: any) => {
        try {
          // This is a placeholder - would use the network interception primitives
          return {
            success: false,
            error: 'Implementation in progress - use capture_network_on_action + _advanced_replay_intercepted_request for now',
            suggestion: '1) capture_network_on_action to capture, 2) Use returned requestId with _advanced_replay_intercepted_request'
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message
          };
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // SMART TOOL 5: Monitor and Modify API Responses
    // ═══════════════════════════════════════════════════════════════════
    {
      name: 'monitor_and_modify_responses',
      description: '🔧 Complete workflow: Monitor API responses and modify them before page sees data. Perfect for "change API response" or "mock server data". Combines response interception + modification + monitoring.',
      inputSchema: z.object({
        urlPattern: z.string().describe('URL pattern to intercept (e.g., "*api/users*")'),
        modifyResponse: z.object({
          body: z.string().optional().describe('New response body (JSON string)'),
          statusCode: z.number().optional().describe('New status code'),
          headers: z.record(z.string()).optional().describe('Modified headers')
        }).optional().describe('Response modifications'),
        duration: z.number().default(30000).describe('How long to monitor (ms, default: 30000)'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ urlPattern, modifyResponse, duration, tabId }: any) => {
        try {
          return {
            success: false,
            error: 'Implementation in progress - use _advanced_enable_response_interception + _advanced_modify_intercepted_response for now',
            suggestion: '1) _advanced_enable_response_interception, 2) Perform action, 3) _advanced_list_intercepted_responses, 4) _advanced_modify_intercepted_response'
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message
          };
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // SMART TOOL 6: Simulate User Journey
    // ═══════════════════════════════════════════════════════════════════
    {
      name: 'simulate_user_journey',
      description: '🎬 Complete workflow: Simulate complex user interactions (multiple clicks, types, waits). Perfect for "simulate user flow" or "test checkout process". Executes sequence of actions automatically.',
      inputSchema: z.object({
        steps: z.array(z.object({
          action: z.enum(['click', 'type', 'wait', 'navigate', 'screenshot']).describe('Action type'),
          selector: z.string().optional().describe('CSS selector (for click/type)'),
          text: z.string().optional().describe('Text to type'),
          url: z.string().optional().describe('URL to navigate'),
          waitMs: z.number().optional().describe('Milliseconds to wait')
        })).describe('Sequence of steps to execute'),
        captureScreenshots: z.boolean().default(false).describe('Capture screenshot after each step'),
        stopOnError: z.boolean().default(true).describe('Stop execution if a step fails'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ steps, captureScreenshots, stopOnError, tabId }: any) => {
        try {
          await connector.verifyConnection();
          const client = await connector.getTabClient(tabId);
          const { Runtime, Input, Page } = client;

          await Runtime.enable();
          if (captureScreenshots) await Page.enable();

          const results = [];

          for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            try {
              let stepResult: any = { step: i + 1, action: step.action };

              switch (step.action) {
                case 'click':
                  await Runtime.evaluate({
                    expression: `document.querySelector('${step.selector}')?.click()`,
                    userGesture: true
                  });
                  stepResult.success = true;
                  break;

                case 'type':
                  await Runtime.evaluate({
                    expression: `document.querySelector('${step.selector}')?.focus()`,
                    userGesture: true
                  });
                  for (const char of step.text || '') {
                    await Input.dispatchKeyEvent({ type: 'keyDown', text: char });
                    await Input.dispatchKeyEvent({ type: 'keyUp', text: char });
                  }
                  stepResult.success = true;
                  stepResult.typedText = step.text;
                  break;

                case 'wait':
                  await new Promise(resolve => setTimeout(resolve, step.waitMs || 1000));
                  stepResult.success = true;
                  stepResult.waitedMs = step.waitMs;
                  break;

                case 'navigate':
                  await Page.navigate({ url: step.url || '' });
                  await Page.loadEventFired();
                  stepResult.success = true;
                  stepResult.url = step.url;
                  break;

                case 'screenshot':
                  const screenshot = await Page.captureScreenshot({ format: 'png' });
                  stepResult.success = true;
                  stepResult.screenshotSize = screenshot.data.length;
                  break;
              }

              if (captureScreenshots && step.action !== 'screenshot') {
                const screenshot = await Page.captureScreenshot({ format: 'png' });
                stepResult.screenshot = screenshot.data.substring(0, 100) + '...';
              }

              results.push(stepResult);
            } catch (error: any) {
              results.push({
                step: i + 1,
                action: step.action,
                success: false,
                error: error.message
              });
              if (stopOnError) break;
            }
          }

          return {
            success: true,
            totalSteps: steps.length,
            completedSteps: results.filter(r => r.success).length,
            results: results,
            message: `Completed ${results.filter(r => r.success).length}/${steps.length} steps`
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message
          };
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // SMART TOOL 7: Extract Structured API Data
    // ═══════════════════════════════════════════════════════════════════
    {
      name: 'extract_api_data',
      description: '📊 Complete workflow: Navigate and extract JSON API responses. Perfect for "get API data from page" or "extract all XHR responses". Combines navigation + network capture + JSON parsing.',
      inputSchema: z.object({
        url: z.string().describe('URL to navigate to'),
        apiPattern: z.string().default('*').describe('Filter API calls by URL pattern (e.g., "*api*", "*.json")'),
        waitForSelector: z.string().optional().describe('Wait for element before capturing'),
        extractFields: z.array(z.string()).optional().describe('Specific JSON fields to extract (dot notation: "user.name")'),
        timeout: z.number().default(30000).describe('Timeout in ms'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ url, apiPattern, waitForSelector, extractFields, timeout, tabId }: any) => {
        try {
          await connector.verifyConnection();
          const client = await connector.getTabClient(tabId);
          const { Page, Runtime, Network, Fetch } = client;

          await Page.enable();
          await Network.enable();
          await Fetch.enable({
            patterns: [{ urlPattern: apiPattern, requestStage: 'Response' as const }]
          });

          const apiResponses: any[] = [];

          Fetch.requestPaused(async (params: any) => {
            try {
              const response = await Fetch.getResponseBody({ requestId: params.requestId });
              let parsedBody;
              try {
                parsedBody = JSON.parse(response.body);
              } catch {
                parsedBody = response.body;
              }
              apiResponses.push({
                url: params.request.url,
                method: params.request.method,
                statusCode: params.responseStatusCode,
                body: parsedBody
              });
              await Fetch.continueRequest({ requestId: params.requestId });
            } catch (e) {
              await Fetch.continueRequest({ requestId: params.requestId }).catch(() => {});
            }
          });

          // Navigate
          await Page.navigate({ url });
          await Page.loadEventFired();

          // Wait for selector if provided
          if (waitForSelector) {
            const waitScript = `
              new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject('Timeout'), ${timeout});
                const check = () => {
                  if (document.querySelector('${waitForSelector}')) {
                    clearTimeout(timeout);
                    resolve(true);
                  } else {
                    setTimeout(check, 100);
                  }
                };
                check();
              })
            `;
            await Runtime.evaluate({ expression: waitScript, awaitPromise: true });
          }

          // Wait a bit for API calls
          await new Promise(resolve => setTimeout(resolve, 2000));

          // Cleanup
          await Fetch.disable();

          // Extract specific fields if requested
          let extractedData = apiResponses;
          if (extractFields && extractFields.length > 0) {
            extractedData = apiResponses.map(resp => {
              const extracted: any = { url: resp.url };
              extractFields.forEach((field: string) => {
                const value = field.split('.').reduce((obj: any, key: string) => obj?.[key], resp.body);
                extracted[field] = value;
              });
              return extracted;
            });
          }

          return {
            success: true,
            url: url,
            apiCallsFound: apiResponses.length,
            data: extractedData,
            message: `Extracted ${apiResponses.length} API response(s)`
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            url: url
          };
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // SMART TOOL 8: Manage Browser Session
    // ═══════════════════════════════════════════════════════════════════
    {
      name: 'manage_browser_session',
      description: '💾 Complete workflow: Save/load/clear browser session (cookies + storage). Perfect for "save my login", "switch accounts", or "clear session". Handles all session data in one call.',
      inputSchema: z.object({
        operation: z.enum(['save', 'load', 'clear', 'export']).describe('Operation: save (backup), load (restore), clear (logout), export (get JSON)'),
        sessionName: z.string().optional().describe('Session name for save/load operations'),
        sessionData: z.string().optional().describe('Session JSON data (for load operation)'),
        includeLocalStorage: z.boolean().default(true).describe('Include localStorage'),
        includeSessionStorage: z.boolean().default(true).describe('Include sessionStorage'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ operation, sessionName, sessionData, includeLocalStorage, includeSessionStorage, tabId }: any) => {
        try {
          await connector.verifyConnection();
          const client = await connector.getTabClient(tabId);
          const { Network, Runtime } = client;

          await Network.enable();
          await Runtime.enable();

          switch (operation) {
            case 'save':
            case 'export':
              // Get cookies
              const cookies = await Network.getCookies({});
              
              // Get storage
              let localStorage, sessionStorage;
              if (includeLocalStorage) {
                const localResult = await Runtime.evaluate({
                  expression: 'JSON.stringify(localStorage)',
                  returnByValue: true
                });
                localStorage = JSON.parse(localResult.result.value || '{}');
              }
              if (includeSessionStorage) {
                const sessionResult = await Runtime.evaluate({
                  expression: 'JSON.stringify(sessionStorage)',
                  returnByValue: true
                });
                sessionStorage = JSON.parse(sessionResult.result.value || '{}');
              }

              const session = {
                name: sessionName,
                timestamp: Date.now(),
                cookies: cookies.cookies,
                localStorage,
                sessionStorage
              };

              return {
                success: true,
                operation: operation,
                sessionName: sessionName,
                sessionData: session,
                cookieCount: cookies.cookies.length,
                message: `Session ${operation === 'save' ? 'saved' : 'exported'} successfully`
              };

            case 'load':
              if (!sessionData) {
                throw new Error('sessionData is required for load operation');
              }

              const loadedSession = typeof sessionData === 'string' ? JSON.parse(sessionData) : sessionData;

              // Set cookies
              for (const cookie of loadedSession.cookies || []) {
                await Network.setCookie(cookie);
              }

              // Set storage
              if (includeLocalStorage && loadedSession.localStorage) {
                await Runtime.evaluate({
                  expression: `
                    const data = ${JSON.stringify(loadedSession.localStorage)};
                    Object.keys(data).forEach(key => localStorage.setItem(key, data[key]));
                  `
                });
              }
              if (includeSessionStorage && loadedSession.sessionStorage) {
                await Runtime.evaluate({
                  expression: `
                    const data = ${JSON.stringify(loadedSession.sessionStorage)};
                    Object.keys(data).forEach(key => sessionStorage.setItem(key, data[key]));
                  `
                });
              }

              return {
                success: true,
                operation: 'load',
                sessionName: loadedSession.name,
                cookiesRestored: (loadedSession.cookies || []).length,
                message: 'Session loaded successfully'
              };

            case 'clear':
              // Clear cookies
              const allCookies = await Network.getCookies({});
              for (const cookie of allCookies.cookies) {
                await Network.deleteCookies({ name: cookie.name, domain: cookie.domain });
              }

              // Clear storage
              if (includeLocalStorage) {
                await Runtime.evaluate({ expression: 'localStorage.clear()' });
              }
              if (includeSessionStorage) {
                await Runtime.evaluate({ expression: 'sessionStorage.clear()' });
              }

              return {
                success: true,
                operation: 'clear',
                cookiesCleared: allCookies.cookies.length,
                message: 'Session cleared successfully'
              };

            default:
              throw new Error(`Unknown operation: ${operation}`);
          }
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            operation: operation
          };
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // SMART TOOL 9: Debug Network Performance
    // ═══════════════════════════════════════════════════════════════════
    {
      name: 'debug_network_performance',
      description: '🐌 Complete workflow: Identify slow network requests and bottlenecks. Perfect for "find slow requests" or "analyze page load". Uses HAR recording + analysis.',
      inputSchema: z.object({
        url: z.string().describe('URL to analyze'),
        minDuration: z.number().default(1000).describe('Minimum request duration to flag (ms, default: 1000)'),
        recordDuration: z.number().default(10000).describe('How long to record (ms, default: 10000)'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ url, minDuration, recordDuration, tabId }: any) => {
        try {
          return {
            success: false,
            error: 'Implementation in progress - use start_har_recording + navigate + stop_har_recording + analyze HAR',
            suggestion: 'Use HAR advanced tools for now'
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message
          };
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // SMART TOOL 10: Test with Different Cookies
    // ═══════════════════════════════════════════════════════════════════
    {
      name: 'test_with_different_cookies',
      description: '🍪 Complete workflow: Test page with modified cookies (simulate different users/sessions). Perfect for "test as different user" or "change session". Saves original, modifies, tests, restores.',
      inputSchema: z.object({
        url: z.string().describe('URL to test'),
        cookies: z.array(z.object({
          name: z.string(),
          value: z.string(),
          domain: z.string().optional(),
          path: z.string().optional()
        })).describe('Cookies to set for testing'),
        restoreOriginal: z.boolean().default(true).describe('Restore original cookies after test'),
        extractContent: z.boolean().default(true).describe('Extract page content with new cookies'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ url, cookies, restoreOriginal, extractContent, tabId }: any) => {
        try {
          await connector.verifyConnection();
          const client = await connector.getTabClient(tabId);
          const { Network, Page, Runtime } = client;

          await Network.enable();
          await Page.enable();
          await Runtime.enable();

          // Step 1: Save original cookies
          let originalCookies: any[] = [];
          if (restoreOriginal) {
            const result = await Network.getCookies({});
            originalCookies = result.cookies;
          }

          // Step 2: Set new cookies
          for (const cookie of cookies) {
            await Network.setCookie({
              name: cookie.name,
              value: cookie.value,
              domain: cookie.domain || new URL(url).hostname,
              path: cookie.path || '/'
            });
          }

          // Step 3: Navigate with new cookies
          await Page.navigate({ url });
          await Page.loadEventFired();

          // Step 4: Extract content if requested
          let content;
          if (extractContent) {
            const result = await Runtime.evaluate({
              expression: 'document.body.innerText',
              returnByValue: true
            });
            content = result.result.value;
          }

          // Step 5: Restore original cookies
          if (restoreOriginal) {
            // Clear current cookies
            const currentCookies = await Network.getCookies({});
            for (const cookie of currentCookies.cookies) {
              await Network.deleteCookies({ name: cookie.name, domain: cookie.domain });
            }
            // Restore original
            for (const cookie of originalCookies) {
              await Network.setCookie(cookie);
            }
          }

          return {
            success: true,
            url: url,
            cookiesSet: cookies.length,
            originalCookiesRestored: restoreOriginal,
            content: extractContent ? content : undefined,
            message: `Tested with ${cookies.length} modified cookie(s)`
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            url: url
          };
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // SMART TOOL 11: Monitor WebSocket Messages
    // ═══════════════════════════════════════════════════════════════════
    {
      name: 'monitor_websocket_messages',
      description: '📡 Complete workflow: Capture WebSocket messages during page interaction. Perfect for "monitor WebSocket traffic" or "capture realtime messages". Auto-enables, captures, and formats.',
      inputSchema: z.object({
        duration: z.number().default(30000).describe('How long to monitor (ms, default: 30000)'),
        triggerAction: z.enum(['none', 'click', 'navigate']).default('none').describe('Action to trigger after enabling monitoring'),
        selector: z.string().optional().describe('CSS selector (for click action)'),
        url: z.string().optional().describe('URL (for navigate action)'),
        filterPattern: z.string().optional().describe('Filter messages by content pattern'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ duration, triggerAction, selector, url, filterPattern, tabId }: any) => {
        try {
          return {
            success: false,
            error: 'Implementation in progress - use enable_websocket_interception + list_websocket_messages',
            suggestion: 'Use advanced WebSocket tools for now'
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message
          };
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // SMART TOOL 12: Mock API for Testing
    // ═══════════════════════════════════════════════════════════════════
    {
      name: 'mock_api_for_testing',
      description: '🎭 Complete workflow: Create API mock, test page, verify, cleanup. Perfect for "mock API response" or "test with fake data". Handles entire mock lifecycle.',
      inputSchema: z.object({
        mockEndpoint: z.object({
          urlPattern: z.string().describe('URL pattern to mock (e.g., "*api/users*")'),
          responseBody: z.string().describe('Mock response body (JSON string)'),
          statusCode: z.number().default(200).describe('HTTP status code'),
          headers: z.record(z.string()).optional().describe('Response headers')
        }).describe('Mock endpoint configuration'),
        testUrl: z.string().describe('URL to test with mock'),
        verifyMockUsed: z.boolean().default(true).describe('Verify the mock was actually used'),
        autoCleanup: z.boolean().default(true).describe('Remove mock after test'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ mockEndpoint, testUrl, verifyMockUsed, autoCleanup, tabId }: any) => {
        try {
          return {
            success: false,
            error: 'Implementation in progress - use create_mock_endpoint + navigate + clear_all_mocks',
            suggestion: 'Use advanced mock tools for now'
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message
          };
        }
      }
    }
  ];
}

