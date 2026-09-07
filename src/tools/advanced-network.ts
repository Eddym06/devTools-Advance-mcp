/**
 * Advanced Network Tools
 * Response interception, mocking, WebSocket, HAR, patterns, injection
 */

import { z } from 'zod';
import type { ChromeConnector } from '../chrome-connector.js';
import { withTimeout, getPackageVersion } from '../utils/helpers.js';
import { resolveOutputPath } from '../utils/file-storage.js';
import * as fs from 'fs/promises';

// Storage for intercepted responses
const interceptedResponses = new Map<string, Map<string, any>>();

// Storage for response history (for auto-continued responses)
const responseHistory = new Map<string, any[]>();

// Storage for response interception state (per tab)
const responseInterceptionState = new Map<string, { autoContinue: boolean; pauseMode: string; pausedCount: number }>();

// Storage for mock endpoints
const mockEndpoints = new Map<string, any[]>();

// Storage for WebSocket connections
const websocketConnections = new Map<string, any[]>();
const websocketMessages = new Map<string, any[]>();

// Storage for HAR recording
const harRecordings = new Map<string, any>();
// Most recently completed HAR per tab (stop_har_recording parks it here so
// export_har_file can still write it — previously the documented
// stop→export flow always failed because stop deleted the recording).
const lastCompletedHar = new Map<string, any>();

// Hard caps so long-lived sessions cannot grow without bound.
const MAX_HISTORY_ENTRIES = 200;
const MAX_WS_CONNECTIONS = 200;
const MAX_WS_MESSAGES = 1000;
const MAX_HAR_ENTRIES = 2000;

// Owning CDP sessions (per tab key) + the unsubscribe handles for their
// event listeners. Fetch/Network enable-state is SESSION-scoped, so every
// enable/disable/modify/fulfill call must go through the session that owns
// the interception; otherwise "disable" is a silent no-op that freezes the
// page on the next matching request.
interface OwnedSession {
  client: any;
  unsubscribe: () => void;
}
const responseInterceptionSessions = new Map<string, OwnedSession>();
const mockSessions = new Map<string, OwnedSession>();
const websocketSessions = new Map<string, OwnedSession>();
// Injection registrations are also session-scoped: keep the registering
// client so remove/clear can actually remove the scripts.
const injectionClients = new Map<string, { client: any; ids: string[] }>();

/**
 * Reset ALL module-level capture/interception state and detach listeners.
 * Called on browser disconnect/relaunch so a fresh Chrome session never
 * inherits stale buffers, paused requests or dead listeners.
 */
export function resetAdvancedNetworkState(): void {
  for (const session of [responseInterceptionSessions, mockSessions, websocketSessions]) {
    for (const entry of session.values()) {
      try { entry.unsubscribe(); } catch { /* ignore */ }
      try { entry.client.Fetch?.disable(); } catch { /* ignore */ }
      try { entry.client.Network?.disable(); } catch { /* ignore */ }
    }
    session.clear();
  }
  interceptedResponses.clear();
  responseHistory.clear();
  responseInterceptionState.clear();
  mockEndpoints.clear();
  websocketConnections.clear();
  websocketMessages.clear();
  harRecordings.clear();
  lastCompletedHar.clear();
  injectedScripts.clear();
  injectionClients.clear();
}

/**
 * Read-only snapshot of the current HAR recording buffer for a tab, without
 * stopping/consuming it (stop_har_recording deletes the entry once read).
 * Used by the chrome://tab/{tabId}/har MCP resource so the recording can be
 * inspected mid-flight instead of only via the stop tool's one-shot return.
 */
export function getHarSnapshot(tabId?: string): any {
  const effectiveTabId = tabId || 'default';
  const recording = harRecordings.get(effectiveTabId);

  if (!recording) {
    return {
      log: {
        version: '1.2',
        creator: { name: 'Custom Chrome MCP', version: getPackageVersion() },
        pages: [],
        entries: [],
      },
      recordingActive: false,
      note: 'No active HAR recording for this tab. Call start_har_recording first.',
    };
  }

  return {
    log: {
      version: '1.2',
      creator: { name: 'Custom Chrome MCP', version: getPackageVersion() },
      pages: recording.pages,
      entries: recording.entries,
    },
    recordingActive: true,
    startTime: recording.startTime,
  };
}

// Storage for injected scripts
const injectedScripts = new Map<string, string[]>();

export function createAdvancedNetworkTools(connector: ChromeConnector) {
  return [
    // ═══════════════════════════════════════════════════════════════════
    // 1. NETWORK RESPONSE INTERCEPTION
    // ═══════════════════════════════════════════════════════════════════
    
    {
      name: 'enable_response_interception',
      description: 'Enable response interception to capture/modify server responses before the browser processes them.',
      inputSchema: z.object({
        patterns: z.array(z.string()).default(['*']).describe('URL patterns to intercept'),
        resourceTypes: z.array(z.string()).optional().describe('Resource types to intercept (Document, Script, XHR, Fetch, etc.)'),
        autoContinue: z.boolean().default(true).describe('Automatically continue responses? TRUE (Default): Logs response to history and continues immediately (No Freeze). FALSE: Pauses browser for manual modification (CAUTION: FREEZES PAGE).'),
        pauseMode: z.enum(['persistent', 'firstOnly', 'limitedPause']).default('persistent').describe('How to handle pausing when autoContinue=false. "persistent" (default): All matching responses pause until disabled. "firstOnly": Only first response pauses, then auto-switches to autoContinue=true. "limitedPause": Pauses up to maxPaused responses, then auto-continues rest.'),
        maxPaused: z.number().default(1).describe('When pauseMode="limitedPause", maximum responses to pause before auto-continuing (default: 1).'),
        timeoutMs: z.number().default(10000).optional().describe('Operation timeout in milliseconds (default: 10000)'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ patterns = ['*'], resourceTypes, autoContinue = true, pauseMode = 'persistent', maxPaused = 1, timeoutMs = 10000, tabId }: any) => {
        try {
          const tabKey = tabId || 'default';
          
          // Check for conflicts with mocks
          if (mockEndpoints.has(tabKey) && mockEndpoints.get(tabKey)!.length > 0) {
            console.error('⚠️ WARNING: Mock endpoints are already active. This may cause conflicts.');
            return {
              success: false,
              error: 'Conflict detected: Mock endpoints are already active',
              suggestion: 'Call clear_all_mocks first, then enable response interception',
              activeMocks: mockEndpoints.get(tabKey)!.length
            };
          }
          
          await withTimeout(
            connector.verifyConnection(),
            Math.min(timeoutMs, 5000),
            'Connection verification timeout'
          );
          
          // Use PERSISTENT client so listeners stay active
          const client = await withTimeout(
            connector.getPersistentClient(tabId),
            Math.min(timeoutMs, 5000),
            'Failed to get persistent tab client'
          );
          
          const { Network, Fetch } = client;
          
          if (!Network || !Fetch) {
            throw new Error('Network or Fetch domain not available. CDP connection may be unstable.');
          }
          
          await withTimeout(Network.enable(), timeoutMs, 'Network.enable timeout');
          
          const requestPatterns: any[] = patterns.map((pattern: string) => {
            const p: any = {
              urlPattern: pattern,
              requestStage: 'Response' as const
            };
            if (resourceTypes && resourceTypes.length > 0) {
              p.resourceType = resourceTypes[0];
            }
            return p;
          });
          
          await withTimeout(
            Fetch.enable({ patterns: requestPatterns }),
            timeoutMs,
            'Fetch.enable timeout'
          );
          
          const effectiveTabId = tabId || 'default';
          if (!interceptedResponses.has(effectiveTabId)) {
            interceptedResponses.set(effectiveTabId, new Map());
          }
          
          // Initialize response interception state
          responseInterceptionState.set(effectiveTabId, {
            autoContinue,
            pauseMode,
            pausedCount: 0
          });
          
          // Tear down a previous response-interception session for this tab:
          // listeners must never stack across re-enables (Fetch.enable above
          // already replaced the pattern set on this same persistent session).
          const previous = responseInterceptionSessions.get(effectiveTabId);
          if (previous) {
            try { previous.unsubscribe(); } catch { /* ignore */ }
            responseInterceptionSessions.delete(effectiveTabId);
          }

          // Register listener on the owning persistent session.
          const unsubscribe = Fetch.requestPaused(async (params: any) => {
            try {
              const responses = interceptedResponses.get(effectiveTabId);
              const state = responseInterceptionState.get(effectiveTabId);

              // Interception disabled but Fetch still enabled (safety net):
              // never leave a response paused without an owner.
              if (!responses || !state) {
                await Fetch.continueRequest({ requestId: params.requestId }).catch(() => {});
                return;
              }

              responses.set(params.requestId, params);
              console.error(`[Response Interceptor] Captured: ${params.request?.url}`);

              // Determine if we should auto-continue this response
              let shouldAutoContinue = state?.autoContinue ?? true;

              // Handle special pause modes when autoContinue is false
              if (state && !state.autoContinue && state.pauseMode !== 'persistent') {
                if (state.pauseMode === 'firstOnly') {
                  // After first pause, switch to auto-continue
                  if (state.pausedCount > 0) {
                    shouldAutoContinue = true;
                  } else {
                    state.pausedCount++;
                  }
                } else if (state.pauseMode === 'limitedPause') {
                  // Pause up to maxPaused responses
                  if (state.pausedCount >= maxPaused) {
                    shouldAutoContinue = true;
                  } else {
                    state.pausedCount++;
                  }
                }
              }

              // Auto-continue if enabled or triggered by pause mode
              if (shouldAutoContinue) {
                // Store in history before continuing and deleting
                if (!responseHistory.has(effectiveTabId)) {
                  responseHistory.set(effectiveTabId, []);
                }
                const history = responseHistory.get(effectiveTabId)!;

                // Add to history (capped)
                history.unshift({
                  ...params,
                  status: 'auto-continued',
                  timestamp: Date.now()
                });
                if (history.length > MAX_HISTORY_ENTRIES) history.pop();

                await Fetch.continueRequest({ requestId: params.requestId });
                responses.delete(params.requestId);
              }
            } catch (e) {
              console.error('[Response Interception] Error storing intercepted response:', e);
              await Fetch.continueRequest({ requestId: params.requestId }).catch(() => {});
            }
          });
          responseInterceptionSessions.set(effectiveTabId, { client, unsubscribe });
          
          console.error(`✅ Response interceptor ACTIVE and listening for patterns: ${patterns.join(', ')}`);
          
          const warningMessage = !autoContinue && pauseMode === 'persistent' 
            ? '⚠️ WARNING: persistent pause mode - You MUST call modify_intercepted_response for EVERY intercepted response, otherwise pages will freeze!' 
            : !autoContinue && pauseMode === 'firstOnly'
            ? '✅ SAFE MODE: Only the FIRST response will pause. Subsequent responses auto-continue.'
            : !autoContinue && pauseMode === 'limitedPause'
            ? `✅ SAFE MODE: Only the first ${maxPaused} response(s) will pause. Subsequent responses auto-continue.`
            : undefined;
          
          return {
            success: true,
            message: `Response interception enabled and LISTENING for patterns: ${patterns.join(', ')}`,
            patterns,
            autoContinue: autoContinue,
            pauseMode: pauseMode,
            maxPaused: pauseMode === 'limitedPause' ? maxPaused : undefined,
            warning: warningMessage,
            stage: 'Response',
            note: 'Interceptor is now ACTIVE and will continue capturing responses until disabled'
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message || 'Unknown error',
            details: error.stack,
            suggestion: 'Ensure Chrome is running with debugging port and page is loaded'
          };
        }
      }
    },

    {
      name: 'disable_response_interception',
      description: 'Disable response interception and clear captured state.',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ tabId }: any) => {
        try {
          await connector.verifyConnection();
          const effectiveTabId = tabId || 'default';

          // Disable Fetch on the SAME session that enabled it (Fetch domain
          // enable-state is session-scoped — disabling elsewhere is a no-op
          // that would leave responses paused forever).
          const session = responseInterceptionSessions.get(effectiveTabId);
          if (session) {
            try { session.unsubscribe(); } catch { /* ignore */ }
            try { await session.client.Fetch.disable(); } catch (e) { console.error('[disable_response_interception] Fetch.disable error:', (e as Error).message); }
            responseInterceptionSessions.delete(effectiveTabId);
          } else {
            // Best-effort fallback for state created before the session fix.
            try {
              const client = await connector.getPersistentClient(tabId);
              await client.Fetch.disable();
            } catch { /* no active interception */ }
          }

          interceptedResponses.delete(effectiveTabId);
          responseInterceptionState.delete(effectiveTabId);

          return {
            success: true,
            message: 'Response interception disabled'
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message || 'Failed to disable response interception'
          };
        }
      }
    },

    {
      name: 'list_intercepted_responses',
      description: '� MANDATORY STEP after enable_response_interception! Lists captured network traffic. USE THIS WHEN: 1️⃣ After clicking button/link, expected content doesn\'t appear in HTML/page. 2️⃣ After form submission, no visible response on page. 3️⃣ Suspecting AJAX/XHR/Fetch requests (background API calls). 4️⃣ Page "loads" but data is missing/incomplete. WHY CRITICAL: Modern websites load data via background requests (APIs) that DON\'T show in HTML/DOM. get_html only shows static markup, NOT dynamic API responses. This tool reveals the "invisible" network traffic. COMMON MISTAKE: Assuming get_html shows everything - it doesn\'t! API responses are SEPARATE from DOM. Shows: URLs, methods, status codes, headers, requestIds.',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ tabId }: any) => {
        try {
          await withTimeout(connector.verifyConnection(), 3000, 'Connection verification timeout');
          const effectiveTabId = tabId || 'default';
          
          const activeResponses = interceptedResponses.get(effectiveTabId);
          const history = responseHistory.get(effectiveTabId) || [];
          
          if ((!activeResponses || activeResponses.size === 0) && history.length === 0) {
            return {
              success: true,
              interceptedResponses: [],
              count: 0,
              message: 'No responses intercepted'
            };
          }
          
          // Format active responses
          const activeList = activeResponses ? Array.from(activeResponses.values()).map((resp: any) => ({
            requestId: resp.requestId,
            url: resp.request?.url || 'unknown',
            method: resp.request?.method || 'unknown',
            responseStatusCode: resp.responseStatusCode,
            responseHeaders: resp.responseHeaders || [],
            status: 'paused (waiting for action)'
          })) : [];

          // Format history responses
          const historyList = history.map((resp: any) => ({
            requestId: resp.requestId,
            url: resp.request?.url || 'unknown',
            method: resp.request?.method || 'unknown',
            responseStatusCode: resp.responseStatusCode || resp.responseCode,
            responseHeaders: resp.responseHeaders || [],
            status: resp.status || 'processed',
            timestamp: resp.timestamp ? new Date(resp.timestamp).toISOString() : undefined
          }));

          const allResponses = [...activeList, ...historyList];
          
          return {
            success: true,
            interceptedResponses: allResponses,
            count: allResponses.length,
            message: `Found ${activeList.length} paused responses and ${historyList.length} processed/auto-continued responses.`
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message || 'Failed to list intercepted responses',
            interceptedResponses: [],
            count: 0
          };
        }
      }
    },

    {
      name: 'modify_intercepted_response',
      description: 'Modify a captured response body, headers, or status code before the browser receives it. Requires requestId from list_intercepted_responses.',
      inputSchema: z.object({
        requestId: z.string().describe('Request ID from list_intercepted_responses'),
        modifiedBody: z.string().optional().describe('New response body (base64 if binary)'),
        modifiedHeaders: z.record(z.string(), z.string()).optional().describe('New/modified response headers'),
        modifiedStatusCode: z.number().optional().describe('New status code (e.g., 200, 404, 500)'),
        timeoutMs: z.number().default(15000).optional().describe('Operation timeout in milliseconds (default: 15000)'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ requestId, modifiedBody, modifiedHeaders, modifiedStatusCode, timeoutMs = 15000, tabId }: any) => {
        try {
          await withTimeout(connector.verifyConnection(), Math.min(timeoutMs, 5000), 'Connection verification timeout');
          const effectiveTabId = tabId || 'default';

          // Fulfill on the SAME session that paused the response (the owner
          // of the interception). Fall back to a fresh client only if no
          // owner is tracked (pre-fix state).
          const session = responseInterceptionSessions.get(effectiveTabId);
          const client = session?.client ?? (await withTimeout(connector.getPersistentClient(tabId), Math.min(timeoutMs, 5000), 'Failed to get tab client'));
          const { Fetch } = client;

          if (!Fetch) {
            throw new Error('Fetch domain not available');
          }

          const responses = interceptedResponses.get(effectiveTabId);
          const originalResponse = responses?.get(requestId);

          if (!originalResponse) {
            return {
              success: false,
              error: `Response ${requestId} not found`,
              suggestion: 'Use list_intercepted_responses to get valid request IDs. The response may have timed out or already been processed.'
            };
          }

          const headers: any[] = [];
          if (modifiedHeaders) {
            Object.entries(modifiedHeaders).forEach(([name, value]) => {
              headers.push({ name, value });
            });
          } else if (originalResponse.responseHeaders) {
            headers.push(...originalResponse.responseHeaders);
          }

          await withTimeout(
            Fetch.fulfillRequest({
              requestId,
              responseCode: modifiedStatusCode || originalResponse.responseStatusCode || 200,
              responseHeaders: headers.length > 0 ? headers : undefined,
              body: modifiedBody ? Buffer.from(modifiedBody).toString('base64') : undefined
            }),
            timeoutMs,
            'Fetch.fulfillRequest timeout'
          );

          responses?.delete(requestId);

          return {
            success: true,
            message: `Response ${requestId} modified`,
            url: originalResponse.request?.url || 'unknown'
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message || 'Failed to modify response',
            details: error.stack,
            suggestion: 'Check if interception is enabled and request ID is valid'
          };
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // 2. REQUEST/RESPONSE MOCKING
    // ═══════════════════════════════════════════════════════════════════

    {
      name: 'create_mock_endpoint',
      description: 'Create a fake API endpoint that intercepts matching URLs and returns custom responses. Cannot run with response interception simultaneously.',
      inputSchema: z.object({
        urlPattern: z.string().describe('URL pattern to mock (supports * wildcards)'),
        responseBody: z.string().describe('Response body (JSON string, HTML, etc.)'),
        statusCode: z.number().default(200).describe('HTTP status code'),
        headers: z.record(z.string(), z.string()).optional().describe('Response headers'),
        latency: z.number().default(0).describe('Simulated latency in milliseconds'),
        method: z.string().optional().describe('HTTP method to match (GET, POST, etc.)'),
        timeoutMs: z.number().default(15000).optional().describe('Operation timeout in milliseconds (default: 15000)'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ urlPattern, responseBody, statusCode = 200, headers = {}, latency = 0, method, timeoutMs = 15000, tabId }: any) => {
        try {
          const tabKey = tabId || 'default';
          
          // Check for conflicts with response interception
          if (interceptedResponses.has(tabKey) && interceptedResponses.get(tabKey)!.size > 0) {
            console.error('⚠️ WARNING: Response interception is already active. This may cause conflicts.');
            return {
              success: false,
              error: 'Conflict detected: Response interception is already active',
              suggestion: 'Call disable_response_interception first, then create mock endpoints',
              interceptedCount: interceptedResponses.get(tabKey)!.size
            };
          }
          
          // Validate inputs
          if (!urlPattern || urlPattern.trim() === '') {
            return {
              success: false,
              error: 'urlPattern is required and cannot be empty'
            };
          }
          
          if (latency < 0 || latency > 60000) {
            return {
              success: false,
              error: 'latency must be between 0 and 60000ms'
            };
          }
          
          await withTimeout(connector.verifyConnection(), 5000, 'Connection timeout');

          const effectiveTabId = tabId || 'default';
          if (!mockEndpoints.has(effectiveTabId)) {
            mockEndpoints.set(effectiveTabId, []);
          }

          // Prevent duplicate registrations of the same pattern+method.
          const duplicate = mockEndpoints.get(effectiveTabId)!.some(
            (m: any) => m.urlPattern === urlPattern && (m.method ?? '').toUpperCase() === (method ?? '').toUpperCase()
          );
          if (duplicate) {
            return {
              success: false,
              error: `A mock endpoint already exists for pattern "${urlPattern}" (method ${method || 'any'})`,
              suggestion: 'Use delete_mock_endpoint to remove it first'
            };
          }

          const mock = {
            urlPattern,
            responseBody,
            statusCode,
            headers: headers || {},
            latency,
            method,
            callCount: 0
          };
          mockEndpoints.get(effectiveTabId)!.push(mock);

          // ── ONE owning session + ONE listener per tab ─────────────────────
          // Multiple mocks must not each Fetch.enable() their own pattern
          // (every call REPLACES the previous pattern set on the session) nor
          // stack requestPaused listeners. The single listener matches every
          // paused request against the live mock list.
          let session = mockSessions.get(effectiveTabId);
          let client: any;
          if (session) {
            client = session.client;
          } else {
            client = await withTimeout(
              connector.getPersistentClient(tabId),
              5000,
              'Get persistent client timeout'
            );
            const { Network, Fetch } = client;
            if (!Network || !Fetch) {
              throw new Error('Network or Fetch domain not available');
            }
            await withTimeout(Network.enable(), timeoutMs, 'Network.enable timeout');

            const unsubscribe = Fetch.requestPaused(async (params: any) => {
              try {
                const url = params.request.url;
                const requestMethod = params.request.method;

                const matchingMock = mockEndpoints.get(effectiveTabId)?.find((m: any) => {
                  try {
                    // Convert glob pattern to regex
                    let urlMatch = false;
                    const pattern = m.urlPattern
                      .replace(/\./g, '\\.')  // Escape dots
                      .replace(/\*/g, '.*')   // * becomes .*
                      .replace(/\?/g, '.');   // ? becomes .

                    const regex = new RegExp(`^${pattern}$`, 'i');
                    urlMatch = regex.test(url);

                    // Fallback: simple contains check
                    if (!urlMatch && m.urlPattern.includes('*')) {
                      const plainPart = m.urlPattern.replace(/\*/g, '');
                      urlMatch = url.includes(plainPart);
                    }

                    const methodMatch = !m.method || m.method.toUpperCase() === requestMethod.toUpperCase();

                    if (urlMatch && methodMatch) {
                      console.error(`[Mock Matcher] ✅ Pattern "${m.urlPattern}" matched URL: ${url}`);
                    }
                    return urlMatch && methodMatch;
                  } catch (e) {
                    console.error('[Mock Matcher] ❌ Pattern matching error:', e);
                    return false;
                  }
                });

                if (matchingMock) {
                  matchingMock.callCount++;
                  console.error(`[Mock Endpoint] 🎯 Intercepted ${requestMethod} ${url} -> Responding with mock data`);

                  if (matchingMock.latency > 0) {
                    await new Promise(resolve => setTimeout(resolve, matchingMock.latency));
                  }

                  const responseHeaders: any[] = [
                    { name: 'Content-Type', value: 'application/json' },
                    ...Object.entries(matchingMock.headers || {}).map(([name, value]) => ({ name, value }))
                  ];

                  // The fulfill timeout must outlast the simulated latency or
                  // slow mocks would time out and silently fall through.
                  await withTimeout(
                    Fetch.fulfillRequest({
                      requestId: params.requestId,
                      responseCode: matchingMock.statusCode,
                      responseHeaders,
                      body: Buffer.from(matchingMock.responseBody).toString('base64')
                    }),
                    Math.max(timeoutMs, (matchingMock.latency || 0) + 10000),
                    'fulfillRequest timeout'
                  );
                } else {
                  await withTimeout(
                    Fetch.continueRequest({ requestId: params.requestId }),
                    Math.min(timeoutMs, 5000),
                    'continueRequest timeout'
                  );
                }
              } catch (e) {
                console.error('[Mock Endpoint] Error processing request:', e);
                try {
                  await Fetch.continueRequest({ requestId: params.requestId });
                } catch (continueError) {
                  console.error('[Mock Endpoint] Failed to continue request:', continueError);
                }
              }
            });

            session = { client, unsubscribe };
            mockSessions.set(effectiveTabId, session);
          }

          // Refresh Fetch.enable with the FULL pattern set so every mock
          // intercepts — not only the most recently created one.
          const allPatterns: any[] = (mockEndpoints.get(effectiveTabId) || []).map((m: any) => ({
            urlPattern: m.urlPattern,
            requestStage: 'Request' as const
          }));
          await withTimeout(
            client.Fetch.enable({ patterns: allPatterns }),
            timeoutMs,
            'Fetch.enable timeout'
          );
          
          console.error(`✅ Mock endpoint ACTIVE for pattern: ${urlPattern}`);
          
          return {
            success: true,
            message: `Mock endpoint created and LISTENING for ${urlPattern}`,
            mock: {
              urlPattern,
              statusCode,
              latency,
              method: method || 'any'
            },
            note: 'Mock is now ACTIVE and will intercept matching requests until cleared'
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message || 'Failed to create mock endpoint',
            details: error.stack,
            suggestion: 'Ensure Chrome is running and page is loaded'
          };
        }
      }
    },

    {
      name: 'list_mock_endpoints',
      description: 'List all active mock endpoints',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ tabId }: any) => {
        await connector.verifyConnection();
        const effectiveTabId = tabId || 'default';
        const mocks = mockEndpoints.get(effectiveTabId) || [];
        
        return {
          success: true,
          mocks: mocks.map((m: any) => ({
            urlPattern: m.urlPattern,
            statusCode: m.statusCode,
            method: m.method || 'any',
            latency: m.latency,
            callCount: m.callCount
          })),
          count: mocks.length
        };
      }
    },

    {
      name: 'delete_mock_endpoint',
      description: 'Delete a specific mock endpoint',
      inputSchema: z.object({
        urlPattern: z.string().describe('URL pattern of mock to delete'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ urlPattern, tabId }: any) => {
        await connector.verifyConnection();
        const effectiveTabId = tabId || 'default';
        const mocks = mockEndpoints.get(effectiveTabId);

        if (!mocks) {
          return { success: false, message: 'No mocks found' };
        }

        const initialLength = mocks.length;
        const filtered = mocks.filter((m: any) => m.urlPattern !== urlPattern);
        mockEndpoints.set(effectiveTabId, filtered);

        // Keep the Fetch pattern set in sync with the live mock list:
        // Fetch.enable REPLACES the patterns, so after a delete the remaining
        // mocks must be re-registered or they would silently stop matching.
        const session = mockSessions.get(effectiveTabId);
        if (session && filtered.length > 0) {
          const patterns: any[] = filtered.map((m: any) => ({
            urlPattern: m.urlPattern,
            requestStage: 'Request' as const
          }));
          try { await session.client.Fetch.enable({ patterns }); } catch (e) { console.error('[delete_mock_endpoint] re-enable failed:', (e as Error).message); }
        } else if (session && filtered.length === 0) {
          try { session.unsubscribe(); } catch { /* ignore */ }
          try { await session.client.Fetch.disable(); } catch { /* ignore */ }
          mockSessions.delete(effectiveTabId);
        }

        return {
          success: true,
          message: `Deleted ${initialLength - filtered.length} mock(s)`,
          remaining: filtered.length
        };
      }
    },

    {
      name: 'clear_all_mocks',
      description: 'Clear all mock endpoints and detach the interceptor listener.',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ tabId }: any) => {
        await connector.verifyConnection();
        const effectiveTabId = tabId || 'default';
        const count = mockEndpoints.get(effectiveTabId)?.length || 0;
        mockEndpoints.delete(effectiveTabId);

        // Unsubscribe + Fetch.disable on the OWNING session. Do NOT close the
        // shared persistent client — console capture and other features may
        // still be attached to it.
        const session = mockSessions.get(effectiveTabId);
        if (session) {
          try { session.unsubscribe(); } catch { /* ignore */ }
          try { await session.client.Fetch.disable(); } catch (e) { console.error('⚠️ Error disabling Fetch:', (e as Error).message); }
          mockSessions.delete(effectiveTabId);
          console.error(`✅ Mock endpoints CLEARED and listener detached`);
        }

        return {
          success: true,
          message: `Cleared ${count} mock endpoint(s) and detached listener`
        };
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // 3. WEBSOCKET INTERCEPTION
    // ═══════════════════════════════════════════════════════════════════

    {
      name: 'enable_websocket_interception',
      description: 'Intercept WebSocket traffic to capture bidirectional real-time messages. Use list_websocket_messages to view.',
      inputSchema: z.object({
        urlPattern: z.string().optional().describe('URL pattern to intercept (optional, default all)'),
        timeoutMs: z.number().default(10000).optional().describe('Operation timeout in milliseconds (default: 10000)'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ urlPattern, timeoutMs = 10000, tabId }: any) => {
        try {
          await withTimeout(connector.verifyConnection(), Math.min(timeoutMs, 5000), 'Connection timeout');
          
          // Use PERSISTENT client
          const client = await withTimeout(
            connector.getPersistentClient(tabId),
            Math.min(timeoutMs, 5000),
            'Get persistent client timeout'
          );
          
          const { Network } = client;
          
          if (!Network) {
            throw new Error('Network domain not available');
          }
          
          await withTimeout(Network.enable(), timeoutMs, 'Network.enable timeout');
          
          const effectiveTabId = tabId || 'default';
          if (!websocketConnections.has(effectiveTabId)) {
            websocketConnections.set(effectiveTabId, []);
          }
          if (!websocketMessages.has(effectiveTabId)) {
            websocketMessages.set(effectiveTabId, []);
          }
          
          // Tear down a previous WebSocket interception for this tab so
          // listeners never stack across re-enables.
          const previousWs = websocketSessions.get(effectiveTabId);
          if (previousWs) {
            try { previousWs.unsubscribe(); } catch { /* ignore */ }
            websocketSessions.delete(effectiveTabId);
          }

          // Register listeners on the owning persistent client; each returns
          // an unsubscribe handle so disable can detach them.
          const unsubscribers: Array<() => void> = [];

          const unsubCreated = Network.webSocketCreated((params: any) => {
            try {
              const conns = websocketConnections.get(effectiveTabId);
              if (conns) {
                conns.push({
                  requestId: params.requestId,
                  url: params.url,
                  initiator: params.initiator,
                  timestamp: Date.now()
                });
                if (conns.length > MAX_WS_CONNECTIONS) conns.splice(0, conns.length - MAX_WS_CONNECTIONS);
              }
            } catch (e) {
              console.error('[WebSocket] Error storing connection:', e);
            }
          });
          unsubscribers.push(unsubCreated);

          const unsubSent = Network.webSocketFrameSent((params: any) => {
            try {
              const messages = websocketMessages.get(effectiveTabId);
              if (messages) {
                messages.push({
                  requestId: params.requestId,
                  timestamp: params.timestamp,
                  direction: 'sent',
                  opcode: params.response?.opcode,
                  mask: params.response?.mask,
                  payloadData: params.response?.payloadData
                });
                if (messages.length > MAX_WS_MESSAGES) messages.splice(0, messages.length - MAX_WS_MESSAGES);
              }
            } catch (e) {
              console.error('[WebSocket] Error storing sent message:', e);
            }
          });
          unsubscribers.push(unsubSent);

          const unsubReceived = Network.webSocketFrameReceived((params: any) => {
            try {
              const messages = websocketMessages.get(effectiveTabId);
              if (messages) {
                messages.push({
                  requestId: params.requestId,
                  timestamp: params.timestamp,
                  direction: 'received',
                  opcode: params.response?.opcode,
                  mask: params.response?.mask,
                  payloadData: params.response?.payloadData
                });
                if (messages.length > MAX_WS_MESSAGES) messages.splice(0, messages.length - MAX_WS_MESSAGES);
              }
            } catch (e) {
              console.error('[WebSocket] Error storing received message:', e);
            }
          });
          unsubscribers.push(unsubReceived);

          const unsubClosed = Network.webSocketClosed((params: any) => {
            try {
              const conns = websocketConnections.get(effectiveTabId);
              if (conns) {
                const conn = conns.find((c: any) => c.requestId === params.requestId);
                if (conn) {
                  conn.closed = true;
                  conn.closedAt = Date.now();
                }
              }
            } catch (e) {
              console.error('[WebSocket] Error marking connection closed:', e);
            }
          });
          unsubscribers.push(unsubClosed);

          websocketSessions.set(effectiveTabId, {
            client,
            unsubscribe: () => {
              for (const unsub of unsubscribers) {
                try { unsub(); } catch { /* ignore */ }
              }
            },
          });
          
          console.error(`✅ WebSocket interceptor ACTIVE and listening`);
          
          return {
            success: true,
            message: 'WebSocket interception enabled and LISTENING',
            pattern: urlPattern || 'all',
            note: 'WebSocket interceptor is now ACTIVE and will capture messages until disabled'
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message || 'Failed to enable WebSocket interception',
            details: error.stack,
            suggestion: 'Ensure Chrome is running and page is loaded'
          };
        }
      }
    },

    {
      name: 'list_websocket_connections',
      description: 'List all WebSocket connections',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ tabId }: any) => {
        await connector.verifyConnection();
        const effectiveTabId = tabId || 'default';
        const conns = websocketConnections.get(effectiveTabId) || [];
        
        return {
          success: true,
          connections: conns.map((c: any) => ({
            requestId: c.requestId,
            url: c.url,
            timestamp: c.timestamp,
            closed: c.closed || false
          })),
          count: conns.length
        };
      }
    },

    {
      name: 'list_websocket_messages',
      description: 'List all WebSocket messages (sent and received)',
      inputSchema: z.object({
        requestId: z.string().optional().describe('Filter by specific WebSocket connection'),
        direction: z.enum(['sent', 'received', 'all']).default('all').describe('Filter by direction'),
        limit: z.number().default(100).describe('Max messages to return'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ requestId, direction = 'all', limit = 100, tabId }: any) => {
        await connector.verifyConnection();
        const effectiveTabId = tabId || 'default';
        let messages = websocketMessages.get(effectiveTabId) || [];
        
        if (requestId) {
          messages = messages.filter((m: any) => m.requestId === requestId);
        }
        
        if (direction !== 'all') {
          messages = messages.filter((m: any) => m.direction === direction);
        }
        
        messages = messages.slice(-limit);
        
        return {
          success: true,
          messages: messages.map((m: any) => ({
            requestId: m.requestId,
            timestamp: m.timestamp,
            direction: m.direction,
            payloadData: m.payloadData
          })),
          count: messages.length
        };
      }
    },

    {
      name: 'send_websocket_message',
      description:
        'Send a message over a WebSocket opened by the page. CDP cannot push frames into an ALREADY-OPEN ' +
        'WebSocket, so this hooks WebSocket construction in the page and, when a (matching) connection opens ' +
        'within the wait window, sends your message over it. success:true means the message was actually sent.',
      inputSchema: z.object({
        requestId: z.string().optional().describe('Optional filter: only send if the new WebSocket URL contains this value'),
        message: z.string().describe('Message to send'),
        waitMs: z.number().default(3000).describe('Max ms to wait for the page to open a matching WebSocket'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ requestId, message, waitMs = 3000, tabId }: any) => {
        try {
          if (!message || message.trim() === '') {
            return { success: false, error: 'message cannot be empty' };
          }

          await withTimeout(connector.verifyConnection(), 3000, 'Connection timeout');
          const client = await withTimeout(connector.getPersistentClient(tabId), 3000, 'Get client timeout');
          const { Runtime } = client;

          if (!Runtime) {
            throw new Error('Runtime domain not available');
          }

          await withTimeout(Runtime.enable(), 3000, 'Runtime.enable timeout');

          const payload = JSON.stringify(message);
          const script = `(async function() {
            const message = ${payload};
            const targetFrag = ${JSON.stringify(requestId || '')};
            const waitMs = ${Math.min(Math.max(waitMs || 3000, 0), 10000)};

            const OrigWS = window.WebSocket;
            if (typeof OrigWS !== 'function') return { sent: false, reason: 'no WebSocket API in page' };

            return await new Promise((resolve) => {
              let sent = false;
              const finish = (reason) => {
                window.WebSocket = OrigWS;
                clearTimeout(timer);
                resolve({ sent, reason });
              };
              const timer = setTimeout(() => finish(sent ? 'sent' : 'no matching WebSocket opened in time'), waitMs);

              const PatchedWS = function(...args) {
                const ws = new OrigWS(...args);
                const url = String(args[0] || '');
                if (!targetFrag || url.includes(targetFrag)) {
                  ws.addEventListener('open', () => {
                    try {
                      if (!sent) { ws.send(message); sent = true; }
                    } catch (e) { /* send failed */ }
                  });
                }
                return ws;
              };
              PatchedWS.prototype = OrigWS.prototype;
              PatchedWS.CONNECTING = OrigWS.CONNECTING;
              PatchedWS.OPEN = OrigWS.OPEN;
              PatchedWS.CLOSING = OrigWS.CLOSING;
              PatchedWS.CLOSED = OrigWS.CLOSED;
              window.WebSocket = PatchedWS;
            });
          })()`;

          const result: any = await withTimeout(
            Runtime.evaluate({ expression: script, awaitPromise: true, returnByValue: true }),
            Math.min(waitMs + 5000, 15000),
            'WebSocket send timed out'
          );

          const value = result.result?.value;
          const ok = !!(value && value.sent === true);

          return {
            success: ok,
            message: ok
              ? 'WebSocket message sent'
              : `Message NOT sent: ${value?.reason || 'unknown'}. CDP cannot push frames into an already-open WebSocket — the page must open a new (matching) connection while this call is waiting.`,
            ...(ok ? { sent: true } : { reason: value?.reason })
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message || 'Failed to send WebSocket message',
            details: error.stack
          };
        }
      }
    },

    {
      name: 'disable_websocket_interception',
      description: 'Stops WebSocket message capturing - ends monitoring of WebSocket connections and message flow. Use when done analyzing WebSocket traffic, to clean up listeners, or to stop real-time message capture.',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ tabId }: any) => {
        await connector.verifyConnection();
        const effectiveTabId = tabId || 'default';

        // Detach the listeners on the OWNING session (they were registered on
        // it) and stop Network events for WebSockets.
        const session = websocketSessions.get(effectiveTabId);
        if (session) {
          try { session.unsubscribe(); } catch { /* ignore */ }
          try { await session.client.Network.disable(); } catch { /* ignore */ }
          websocketSessions.delete(effectiveTabId);
        }
        websocketConnections.delete(effectiveTabId);
        websocketMessages.delete(effectiveTabId);

        return {
          success: true,
          message: 'WebSocket interception disabled'
        };
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // 4. HAR FILE GENERATION & REPLAY
    // ═══════════════════════════════════════════════════════════════════

    {
      name: 'start_har_recording',
      description: 'Start recording all network traffic in HAR format for performance analysis or debugging.',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getPersistentClient(tabId);
        const { Network, Page } = client;
        
        await Network.enable();
        await Page.enable();
        
        const effectiveTabId = tabId || 'default';
        const recording: any = {
          startTime: Date.now(),
          entries: [],
          pages: []
        };
        
        harRecordings.set(effectiveTabId, recording);
        
        // Track monotonic start times so per-request `time` uses real deltas
        // (Network.timestamp is a monotonic clock, NOT wall time).
        const startTimes = new Map<string, number>();

        Network.requestWillBeSent((params: any) => {
          if (recording.entries.length >= MAX_HAR_ENTRIES) return;
          startTimes.set(params.requestId, params.timestamp);

          let queryString: Array<{ name: string; value: string }> = [];
          try {
            const parsed = new URL(params.request.url);
            queryString = [...parsed.searchParams.entries()].map(([name, value]) => ({ name, value }));
          } catch { /* non-http URL (data:, chrome:, …) */ }

          const entry: any = {
            requestId: params.requestId,
            startedDateTime: new Date((params.wallTime ?? Date.now() / 1000) * 1000).toISOString(),
            time: -1,
            request: {
              method: params.request.method,
              url: params.request.url,
              httpVersion: 'HTTP/1.1',
              headers: Object.entries(params.request.headers || {}).map(([name, value]) => ({ name, value })),
              queryString,
              cookies: [],
              headersSize: -1,
              bodySize: params.request.postData ? params.request.postData.length : 0
            },
            response: {
              status: 0,
              statusText: '',
              httpVersion: '',
              headers: [],
              cookies: [],
              content: { size: 0, mimeType: '' },
              redirectURL: '',
              headersSize: -1,
              bodySize: -1
            },
            cache: {},
            timings: {
              blocked: -1,
              dns: -1,
              connect: -1,
              send: 0,
              wait: 0,
              receive: 0,
              ssl: -1
            }
          };

          recording.entries.push(entry);
        });

        Network.responseReceived((params: any) => {
          const entry = recording.entries.find((e: any) => e.requestId === params.requestId);
          if (entry) {
            entry.response = {
              status: params.response.status,
              statusText: params.response.statusText,
              httpVersion: params.response.protocol || 'HTTP/1.1',
              headers: Object.entries(params.response.headers || {}).map(([name, value]) => ({ name, value })),
              cookies: [],
              content: {
                size: 0,
                mimeType: params.response.mimeType || 'application/octet-stream'
              },
              redirectURL: params.response.headers?.['Location'] ?? '',
              headersSize: -1,
              bodySize: -1
            };
          }
        });

        Network.loadingFinished((params: any) => {
          const entry = recording.entries.find((e: any) => e.requestId === params.requestId);
          if (!entry) return;
          const start = startTimes.get(params.requestId);
          if (typeof start === 'number') {
            entry.time = Math.max(0, (params.timestamp - start) * 1000);
          }
          if (typeof params.encodedDataLength === 'number' && entry.response?.content) {
            entry.response.content.size = params.encodedDataLength;
            entry.response.bodySize = params.encodedDataLength;
          }
          startTimes.delete(params.requestId);
        });
        
        return {
          success: true,
          message: 'HAR recording started',
          startTime: recording.startTime
        };
      }
    },

    {
      name: 'stop_har_recording',
      description: 'Stop HAR recording and return captured traffic data.',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ tabId }: any) => {
        await connector.verifyConnection();
        const effectiveTabId = tabId || 'default';
        const recording = harRecordings.get(effectiveTabId);
        
        if (!recording) {
          throw new Error('No active HAR recording');
        }
        
        const har = {
          log: {
            version: '1.2',
            creator: {
              name: 'Custom Chrome MCP',
              version: getPackageVersion()
            },
            pages: recording.pages,
            entries: recording.entries
          }
        };

        // Park the finished recording so export_har_file can still write it
        // after stopping (the documented stop → export flow).
        lastCompletedHar.set(effectiveTabId, { pages: recording.pages || [], entries: recording.entries || [] });

        harRecordings.delete(effectiveTabId);

        return {
          success: true,
          har,
          entriesCount: recording.entries.length,
          duration: Date.now() - recording.startTime,
          nextStep: 'Call export_har_file to save this recording to disk'
        };
      }
    },

    {
      name: 'export_har_file',
      description:
        'Save HAR data to disk as a .har file. Works whether a recording is still ACTIVE (exports the live snapshot) ' +
        'or was already stopped with stop_har_recording (exports the last completed recording). ' +
        'Output is sandboxed: the file lands inside the working directory or the temp folder only.',
      inputSchema: z.object({
        filename: z.string().describe('Filename to save HAR (e.g., recording.har)'),
        outputDir: z.string().optional().describe('Output directory (optional; must be inside the working directory or temp folder)'),
        timeoutMs: z.number().default(60000).optional().describe('File write timeout in milliseconds (default: 60000)'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ filename, outputDir, timeoutMs = 60000, tabId }: any) => {
        try {
          // Validate filename
          if (!filename || filename.trim() === '') {
            return {
              success: false,
              error: 'filename is required'
            };
          }

          await withTimeout(connector.verifyConnection(), 3000, 'Connection timeout');
          const effectiveTabId = tabId || 'default';

          // Accept an ACTIVE recording (live snapshot) OR the most recently
          // completed one (after stop_har_recording).
          const recording = harRecordings.get(effectiveTabId);
          const completed = lastCompletedHar.get(effectiveTabId);
          const source: { pages: any[]; entries: any[] } = recording
            ? { pages: recording.pages || [], entries: recording.entries || [] }
            : completed;
          const fromActive = !!recording;

          if (!source || source.entries.length === 0) {
            return {
              success: false,
              error: 'No HAR data to export',
              suggestion: 'Call start_har_recording, trigger traffic, then stop_har_recording — then export.'
            };
          }

          const har = {
            log: {
              version: '1.2',
              creator: {
                name: 'Custom Chrome MCP',
                version: getPackageVersion()
              },
              pages: source.pages,
              entries: source.entries
            }
          };

          const safeName = filename.toLowerCase().endsWith('.har') ? filename : `${filename}.har`;
          const { filePath } = resolveOutputPath(outputDir, safeName, 'chrome-mcp-har');

          await withTimeout(
            fs.writeFile(filePath, JSON.stringify(har, null, 2), 'utf-8'),
            timeoutMs,
            'File write timeout'
          );

          return {
            success: true,
            message: `HAR file exported to ${filePath}`,
            filepath: filePath,
            entriesCount: source.entries.length,
            fromActiveRecording: fromActive
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message || 'Failed to export HAR file',
            details: error.stack,
            suggestion: 'Check the filename/path are allowed (working directory or temp folder) and disk is writable'
          };
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // 5. ADVANCED REQUEST PATTERNS
    // ═══════════════════════════════════════════════════════════════════

    {
      name: 'add_advanced_interception_pattern',
      description: 'Add advanced request filtering by status code, size, duration, or content-type. Actions: log, block, delay.',
      inputSchema: z.object({
        name: z.string().describe('Pattern name for reference'),
        urlPattern: z.string().optional().describe('URL pattern (glob)'),
        method: z.string().optional().describe('HTTP method'),
        resourceType: z.string().optional().describe('Resource type'),
        statusCodeMin: z.number().optional().describe('Min status code'),
        statusCodeMax: z.number().optional().describe('Max status code'),
        minSize: z.number().optional().describe('Min response size in bytes'),
        maxSize: z.number().optional().describe('Max response size in bytes'),
        minDuration: z.number().optional().describe('Min request duration in ms'),
        contentType: z.string().optional().describe('Content-Type to match'),
        action: z.enum(['log', 'block', 'delay']).default('log').describe('Action to take'),
        delayMs: z.number().optional().describe('Delay in ms (if action=delay)'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ name, urlPattern, method, resourceType, statusCodeMin, statusCodeMax, minSize, maxSize, minDuration, contentType, action = 'log', delayMs, tabId }: any) => {
        await connector.verifyConnection();
        // Persistent session: the pattern stays live until disabled, so it
        // must own its listeners on the session that enabled Fetch.
        const client = await connector.getPersistentClient(tabId);
        const { Network, Fetch } = client;
        
        await Network.enable();
        
        const pattern = {
          name,
          urlPattern,
          method,
          resourceType,
          statusCodeMin,
          statusCodeMax,
          minSize,
          maxSize,
          minDuration,
          contentType,
          action,
          delayMs,
          matchCount: 0
        };
        
        // Store request start times for duration calculation
        const requestTimes = new Map<string, number>();
        
        // Enable Network domain for advanced monitoring
        await Network.enable();
        
        // Track request start times
        Network.requestWillBeSent((params: any) => {
          requestTimes.set(params.requestId, params.timestamp);
        });
        
        // Monitor responses for advanced filtering
        Network.responseReceived((params: any) => {
          const url = params.response.url;
          const status = params.response.status;
          const mimeType = params.response.mimeType;
          const startTime = requestTimes.get(params.requestId);
          const duration = startTime ? (params.timestamp - startTime) * 1000 : 0;
          
          let matches = true;
          
          // URL pattern matching (glob→regex; dots escaped so "." matches a
          // literal dot, not any character)
          if (urlPattern) {
            const regex = new RegExp(urlPattern.replace(/\./g, '\\.').replace(/\*/g, '.*'));
            if (!regex.test(url)) matches = false;
          }
          
          // Status code filtering
          if (statusCodeMin && status < statusCodeMin) matches = false;
          if (statusCodeMax && status > statusCodeMax) matches = false;
          
          // Content-Type filtering
          if (contentType && mimeType && !mimeType.includes(contentType)) matches = false;
          
          // Duration filtering
          if (minDuration && duration < minDuration) matches = false;
          
          // Size filtering (will be checked on loadingFinished)
          if (matches) {
            // For 'log' action, just increment counter
            if (action === 'log') {
              pattern.matchCount++;
              // NOTE: console.error — this code runs inside the MCP stdio
              // process and console.log would corrupt the JSON-RPC stream.
              console.error(`[Pattern: ${name}] Matched request:`, {
                url,
                status,
                mimeType,
                duration: `${duration.toFixed(0)}ms`
              });
            }
          }
          
          requestTimes.delete(params.requestId);
        });
        
        // Enable Fetch for blocking/delaying (basic filtering)
        if (action === 'block' || action === 'delay') {
          if (urlPattern) {
            await Fetch.enable({
              patterns: [{
                urlPattern,
                requestStage: 'Request' as const
              }]
            });
            
            Fetch.requestPaused(async (params: any) => {
              try {
                let matches = true;

                if (method && params.request.method !== method) matches = false;
                if (resourceType && params.resourceType !== resourceType) matches = false;

                if (matches && action === 'block') {
                  await Fetch.failRequest({
                    requestId: params.requestId,
                    errorReason: 'BlockedByClient'
                  });
                  pattern.matchCount++;
                } else if (matches && action === 'delay') {
                  if (delayMs) {
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                  }
                  await Fetch.continueRequest({ requestId: params.requestId });
                  pattern.matchCount++;
                } else {
                  await Fetch.continueRequest({ requestId: params.requestId });
                }
              } catch (e) {
                console.error(`[Pattern: ${name}] requestPaused error:`, e);
                // Never leave a request paused because bookkeeping threw.
                await Fetch.continueRequest({ requestId: params.requestId }).catch(() => {});
              }
            });
          }
        }
        
        return {
          success: true,
          message: `Advanced pattern '${name}' added`,
          pattern: {
            name,
            action,
            filters: {
              urlPattern,
              method,
              resourceType,
              statusCode: statusCodeMin && statusCodeMax ? `${statusCodeMin}-${statusCodeMax}` : undefined,
              size: minSize && maxSize ? `${minSize}-${maxSize}` : undefined,
              duration: minDuration ? `>${minDuration}ms` : undefined,
              contentType
            }
          },
          note: action === 'log' 
            ? 'Pattern will log matching requests to console' 
            : `Pattern will ${action} matching requests`
        };
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // 6. CSS/JS INJECTION PIPELINE
    // ═══════════════════════════════════════════════════════════════════

    {
      name: 'inject_css_global',
      description: 'Inject persistent CSS into all pages (survives navigation). Use !important for specificity.',
      inputSchema: z.object({
        css: z.string().describe('CSS code to inject'),
        name: z.string().optional().describe('Name for this injection (for reference)'),
        timeoutMs: z.number().default(10000).optional().describe('Operation timeout in milliseconds (default: 10000)'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ css, name, timeoutMs = 10000, tabId }: any) => {
        try {
          if (!css || css.trim() === '') {
            return {
              success: false,
              error: 'css cannot be empty'
            };
          }
          
          await withTimeout(connector.verifyConnection(), 5000, 'Connection timeout');
          const client = await withTimeout(connector.getPersistentClient(tabId), 5000, 'Get client timeout');
          const { Page } = client;
          
          if (!Page) {
            throw new Error('Page domain not available');
          }
          
          await withTimeout(Page.enable(), 5000, 'Page.enable timeout');
          
          // Escape CSS safely
          const escapedCSS = css.replace(/`/g, '\\`').replace(/\$/g, '\\$');
          const escapedName = (name || 'unnamed').replace(/'/g, "\\'");
          
          const script = `
            (function() {
              try {
                const style = document.createElement('style');
                style.textContent = \`${escapedCSS}\`;
                style.setAttribute('data-mcp-injection', '${escapedName}');
                if (document.head) {
                  document.head.appendChild(style);
                } else {
                  // Fallback if head doesn't exist yet
                  document.addEventListener('DOMContentLoaded', () => {
                    document.head.appendChild(style);
                  });
                }
                return 'success';
              } catch (e) {
                return 'error: ' + e.message;
              }
            })();
          `;
          
          const result: any = await withTimeout(
            Page.addScriptToEvaluateOnNewDocument({ source: script }),
            timeoutMs,
            'addScriptToEvaluateOnNewDocument timeout'
          );
          
          const effectiveTabId = tabId || 'default';
          if (!injectedScripts.has(effectiveTabId)) {
            injectedScripts.set(effectiveTabId, []);
          }
          injectedScripts.get(effectiveTabId)!.push(result.identifier);
          
          // Also inject in current page
          const { Runtime } = client;
          if (Runtime) {
            await withTimeout(Runtime.enable(), Math.min(timeoutMs, 3000), 'Runtime.enable timeout');
            await withTimeout(
              Runtime.evaluate({ expression: script }),
              timeoutMs,
              'Runtime.evaluate timeout'
            );
          }
          
          return {
            success: true,
            message: 'CSS injected globally',
            identifier: result.identifier,
            name: name || 'unnamed'
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message || 'Failed to inject CSS',
            details: error.stack,
            suggestion: 'Check CSS syntax and ensure page is loaded'
          };
        }
      }
    },

    {
      name: 'inject_js_global',
      description: 'Inject persistent JavaScript that runs before page scripts load on all pages.',
      inputSchema: z.object({
        javascript: z.string().describe('JavaScript code to inject'),
        name: z.string().optional().describe('Name for this injection (for reference)'),
        runImmediately: z.boolean().default(true).describe('Also run in current page'),
        timeoutMs: z.number().default(15000).optional().describe('Operation timeout in milliseconds (default: 15000)'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ javascript, name, runImmediately = true, timeoutMs = 15000, tabId }: any) => {
        try {
          if (!javascript || javascript.trim() === '') {
            return {
              success: false,
              error: 'javascript cannot be empty'
            };
          }
          
          await withTimeout(connector.verifyConnection(), Math.min(timeoutMs, 5000), 'Connection timeout');
          const client = await withTimeout(connector.getPersistentClient(tabId), Math.min(timeoutMs, 5000), 'Get client timeout');
          const { Page } = client;
          
          if (!Page) {
            throw new Error('Page domain not available');
          }
          
          await withTimeout(Page.enable(), timeoutMs, 'Page.enable timeout');
          
          // Validate JavaScript syntax
          try {
            new Function(javascript);
          } catch (syntaxError: any) {
            return {
              success: false,
              error: 'JavaScript syntax error',
              details: syntaxError.message,
              suggestion: 'Check your JavaScript code for syntax errors'
            };
          }
          
          const result: any = await withTimeout(
            Page.addScriptToEvaluateOnNewDocument({ source: javascript }),
            timeoutMs,
            'addScriptToEvaluateOnNewDocument timeout'
          );
          
          const effectiveTabId = tabId || 'default';
          if (!injectedScripts.has(effectiveTabId)) {
            injectedScripts.set(effectiveTabId, []);
          }
          injectedScripts.get(effectiveTabId)!.push(result.identifier);
          
          if (runImmediately) {
            const { Runtime } = client;
            if (Runtime) {
              await withTimeout(Runtime.enable(), Math.min(timeoutMs, 3000), 'Runtime.enable timeout');
              const evalResult: any = await withTimeout(
                Runtime.evaluate({ expression: javascript, returnByValue: false }),
                timeoutMs,
                'Runtime.evaluate timeout'
              );
              
              if (evalResult.exceptionDetails) {
                return {
                  success: true,
                  message: 'JavaScript injected globally but execution failed in current page',
                  identifier: result.identifier,
                  name: name || 'unnamed',
                  executionError: evalResult.exceptionDetails.text,
                  runImmediately
                };
              }
            }
          }
          
          return {
            success: true,
            message: 'JavaScript injected globally',
            identifier: result.identifier,
            name: name || 'unnamed',
            runImmediately
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message || 'Failed to inject JavaScript',
            details: error.stack,
            suggestion: 'Check JavaScript syntax and ensure page is loaded'
          };
        }
      }
    },

    {
      name: 'list_injected_scripts',
      description: 'List all active global CSS/JS injections with their identifiers.',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ tabId }: any) => {
        await connector.verifyConnection();
        const effectiveTabId = tabId || 'default';
        const scripts = injectedScripts.get(effectiveTabId) || [];
        
        return {
          success: true,
          injections: scripts,
          count: scripts.length
        };
      }
    },

    {
      name: 'remove_injection',
      description: 'Remove a specific global CSS/JS injection by identifier.',
      inputSchema: z.object({
        identifier: z.string().describe('Injection identifier from inject_css_global or inject_js_global'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ identifier, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getPersistentClient(tabId);
        const { Page } = client;
        
        await Page.removeScriptToEvaluateOnNewDocument({
          identifier
        });
        
        const effectiveTabId = tabId || 'default';
        const scripts = injectedScripts.get(effectiveTabId);
        if (scripts) {
          const filtered = scripts.filter((id: string) => id !== identifier);
          injectedScripts.set(effectiveTabId, filtered);
        }
        
        return {
          success: true,
          message: `Injection ${identifier} removed`
        };
      }
    },

    {
      name: 'clear_all_injections',
      description: 'Remove all global CSS/JS injections at once.',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getPersistentClient(tabId);
        const { Page } = client;
        
        const effectiveTabId = tabId || 'default';
        const scripts = injectedScripts.get(effectiveTabId) || [];
        
        for (const identifier of scripts) {
          try {
            await Page.removeScriptToEvaluateOnNewDocument({ identifier });
          } catch (e) {
            // Ignore errors for already removed scripts
          }
        }
        
        injectedScripts.delete(effectiveTabId);
        
        return {
          success: true,
          message: `Cleared ${scripts.length} injection(s)`
        };
      }
    }
  ];
}
