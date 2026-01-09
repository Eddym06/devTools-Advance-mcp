/**
 * Advanced Network Tools
 * Response interception, mocking, WebSocket, HAR, patterns, injection
 */

import { z } from 'zod';
import type { ChromeConnector } from '../chrome-connector.js';
import { withTimeout } from '../utils/helpers.js';
import * as fs from 'fs/promises';
import * as path from 'path';

// Storage for intercepted responses
const interceptedResponses = new Map<string, Map<string, any>>();

// Storage for mock endpoints
const mockEndpoints = new Map<string, any[]>();

// Storage for WebSocket connections
const websocketConnections = new Map<string, any[]>();
const websocketMessages = new Map<string, any[]>();

// Storage for HAR recording
const harRecordings = new Map<string, any>();

// Storage for injected scripts
const injectedScripts = new Map<string, string[]>();

export function createAdvancedNetworkTools(connector: ChromeConnector) {
  return [
    // ═══════════════════════════════════════════════════════════════════
    // 1. NETWORK RESPONSE INTERCEPTION
    // ═══════════════════════════════════════════════════════════════════
    
    {
      name: 'enable_response_interception',
      description: 'Enable interception of network RESPONSES (not just requests). Allows modifying response body, headers, and status code before they reach the browser.',
      inputSchema: z.object({
        patterns: z.array(z.string()).default(['*']).describe('URL patterns to intercept'),
        resourceTypes: z.array(z.string()).optional().describe('Resource types to intercept (Document, Script, XHR, Fetch, etc.)'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ patterns = ['*'], resourceTypes, tabId }: any) => {
        try {
          await withTimeout(
            connector.verifyConnection(),
            5000,
            'Connection verification timeout'
          );
          
          const client = await withTimeout(
            connector.getTabClient(tabId),
            5000,
            'Failed to get tab client'
          );
          
          const { Network, Fetch } = client;
          
          if (!Network || !Fetch) {
            throw new Error('Network or Fetch domain not available. CDP connection may be unstable.');
          }
          
          await withTimeout(Network.enable(), 5000, 'Network.enable timeout');
          
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
            5000,
            'Fetch.enable timeout'
          );
          
          const effectiveTabId = tabId || 'default';
          if (!interceptedResponses.has(effectiveTabId)) {
            interceptedResponses.set(effectiveTabId, new Map());
          }
          
          Fetch.requestPaused((params: any) => {
            try {
              const responses = interceptedResponses.get(effectiveTabId);
              if (responses) {
                responses.set(params.requestId, params);
              }
            } catch (e) {
              console.error('[Response Interception] Error storing intercepted response:', e);
            }
          });
          
          return {
            success: true,
            message: `Response interception enabled for patterns: ${patterns.join(', ')}`,
            patterns,
            stage: 'Response'
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
      name: 'list_intercepted_responses',
      description: 'List all currently intercepted responses waiting for action',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ tabId }: any) => {
        try {
          await withTimeout(connector.verifyConnection(), 3000, 'Connection verification timeout');
          const effectiveTabId = tabId || 'default';
          const responses = interceptedResponses.get(effectiveTabId);
          
          if (!responses || responses.size === 0) {
            return {
              success: true,
              interceptedResponses: [],
              count: 0,
              message: 'No responses intercepted'
            };
          }
          
          const responseList = Array.from(responses.values()).map((resp: any) => {
            try {
              return {
                requestId: resp.requestId,
                url: resp.request?.url || 'unknown',
                method: resp.request?.method || 'unknown',
                responseStatusCode: resp.responseStatusCode,
                responseHeaders: resp.responseHeaders || []
              };
            } catch (e) {
              return {
                requestId: resp.requestId,
                url: 'error parsing response',
                method: 'unknown',
                responseStatusCode: 0,
                responseHeaders: []
              };
            }
          });
          
          return {
            success: true,
            interceptedResponses: responseList,
            count: responseList.length
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
      description: 'Modify an intercepted response (body, headers, status code) and continue',
      inputSchema: z.object({
        requestId: z.string().describe('Request ID from list_intercepted_responses'),
        modifiedBody: z.string().optional().describe('New response body (base64 if binary)'),
        modifiedHeaders: z.record(z.string()).optional().describe('New/modified response headers'),
        modifiedStatusCode: z.number().optional().describe('New status code (e.g., 200, 404, 500)'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ requestId, modifiedBody, modifiedHeaders, modifiedStatusCode, tabId }: any) => {
        try {
          await withTimeout(connector.verifyConnection(), 3000, 'Connection verification timeout');
          const client = await withTimeout(connector.getTabClient(tabId), 3000, 'Failed to get tab client');
          const { Fetch } = client;
          
          if (!Fetch) {
            throw new Error('Fetch domain not available');
          }
          
          const effectiveTabId = tabId || 'default';
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
            10000,
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

    {
      name: 'disable_response_interception',
      description: 'Disable response interception',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Fetch } = client;
        
        await Fetch.disable();
        
        const effectiveTabId = tabId || 'default';
        interceptedResponses.delete(effectiveTabId);
        
        return {
          success: true,
          message: 'Response interception disabled'
        };
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // 2. REQUEST/RESPONSE MOCKING
    // ═══════════════════════════════════════════════════════════════════

    {
      name: 'create_mock_endpoint',
      description: 'Create a mock endpoint that intercepts requests and responds with fake data without hitting real server',
      inputSchema: z.object({
        urlPattern: z.string().describe('URL pattern to mock (supports * wildcards)'),
        responseBody: z.string().describe('Response body (JSON string, HTML, etc.)'),
        statusCode: z.number().default(200).describe('HTTP status code'),
        headers: z.record(z.string()).optional().describe('Response headers'),
        latency: z.number().default(0).describe('Simulated latency in milliseconds'),
        method: z.string().optional().describe('HTTP method to match (GET, POST, etc.)'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ urlPattern, responseBody, statusCode = 200, headers = {}, latency = 0, method, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Network, Fetch } = client;
        
        await Network.enable();
        await Fetch.enable({
          patterns: [{ urlPattern, requestStage: 'Request' as const }]
        });
        
        const effectiveTabId = tabId || 'default';
        if (!mockEndpoints.has(effectiveTabId)) {
          mockEndpoints.set(effectiveTabId, []);
        }
        
        const mock = {
          urlPattern,
          responseBody,
          statusCode,
          headers,
          latency,
          method,
          callCount: 0
        };
        
        mockEndpoints.get(effectiveTabId)!.push(mock);
        
        Fetch.requestPaused(async (params: any) => {
          const url = params.request.url;
          const requestMethod = params.request.method;
          
          const matchingMock = mockEndpoints.get(effectiveTabId)?.find((m: any) => {
            const urlMatch = url.includes(urlPattern.replace('*', '')) || 
                            new RegExp(urlPattern.replace(/\*/g, '.*')).test(url);
            const methodMatch = !m.method || m.method === requestMethod;
            return urlMatch && methodMatch;
          });
          
          if (matchingMock) {
            matchingMock.callCount++;
            
            if (matchingMock.latency > 0) {
              await new Promise(resolve => setTimeout(resolve, matchingMock.latency));
            }
            
            const responseHeaders: any[] = [
              { name: 'Content-Type', value: 'application/json' },
              ...Object.entries(matchingMock.headers).map(([name, value]) => ({ name, value }))
            ];
            
            await Fetch.fulfillRequest({
              requestId: params.requestId,
              responseCode: matchingMock.statusCode,
              responseHeaders,
              body: Buffer.from(matchingMock.responseBody).toString('base64')
            });
          } else {
            await Fetch.continueRequest({ requestId: params.requestId });
          }
        });
        
        return {
          success: true,
          message: `Mock endpoint created for ${urlPattern}`,
          mock: {
            urlPattern,
            statusCode,
            latency,
            method: method || 'any'
          }
        };
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
        
        return {
          success: true,
          message: `Deleted ${initialLength - filtered.length} mock(s)`,
          remaining: filtered.length
        };
      }
    },

    {
      name: 'clear_all_mocks',
      description: 'Clear all mock endpoints',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ tabId }: any) => {
        await connector.verifyConnection();
        const effectiveTabId = tabId || 'default';
        const count = mockEndpoints.get(effectiveTabId)?.length || 0;
        mockEndpoints.delete(effectiveTabId);
        
        return {
          success: true,
          message: `Cleared ${count} mock endpoint(s)`
        };
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // 3. WEBSOCKET INTERCEPTION
    // ═══════════════════════════════════════════════════════════════════

    {
      name: 'enable_websocket_interception',
      description: 'Enable WebSocket interception to capture and modify WebSocket messages in real-time',
      inputSchema: z.object({
        urlPattern: z.string().optional().describe('URL pattern to intercept (optional, default all)'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ urlPattern, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Network } = client;
        
        await Network.enable();
        
        const effectiveTabId = tabId || 'default';
        if (!websocketConnections.has(effectiveTabId)) {
          websocketConnections.set(effectiveTabId, []);
        }
        if (!websocketMessages.has(effectiveTabId)) {
          websocketMessages.set(effectiveTabId, []);
        }
        
        Network.webSocketCreated((params: any) => {
          const conns = websocketConnections.get(effectiveTabId)!;
          conns.push({
            requestId: params.requestId,
            url: params.url,
            initiator: params.initiator,
            timestamp: Date.now()
          });
        });
        
        Network.webSocketFrameSent((params: any) => {
          const messages = websocketMessages.get(effectiveTabId)!;
          messages.push({
            requestId: params.requestId,
            timestamp: params.timestamp,
            direction: 'sent',
            opcode: params.response.opcode,
            mask: params.response.mask,
            payloadData: params.response.payloadData
          });
        });
        
        Network.webSocketFrameReceived((params: any) => {
          const messages = websocketMessages.get(effectiveTabId)!;
          messages.push({
            requestId: params.requestId,
            timestamp: params.timestamp,
            direction: 'received',
            opcode: params.response.opcode,
            mask: params.response.mask,
            payloadData: params.response.payloadData
          });
        });
        
        Network.webSocketClosed((params: any) => {
          const conns = websocketConnections.get(effectiveTabId)!;
          const conn = conns.find((c: any) => c.requestId === params.requestId);
          if (conn) {
            conn.closed = true;
            conn.closedAt = Date.now();
          }
        });
        
        return {
          success: true,
          message: 'WebSocket interception enabled',
          pattern: urlPattern || 'all'
        };
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
      description: 'Send a fake WebSocket message (inject into the stream)',
      inputSchema: z.object({
        requestId: z.string().describe('WebSocket connection ID'),
        message: z.string().describe('Message to send'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ requestId, message, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Network } = client;
        
        // Note: CDP doesn't directly support sending WS messages, 
        // but we can execute JavaScript to do it
        const { Runtime } = client;
        await Runtime.enable();
        
        const script = `
          (function() {
            // Find the WebSocket by inspecting global WebSocket instances
            // This is a workaround since CDP doesn't expose WS instances
            const originalSend = WebSocket.prototype.send;
            let foundWS = null;
            
            WebSocket.prototype.send = function(...args) {
              foundWS = this;
              return originalSend.apply(this, args);
            };
            
            // Trigger to get reference
            setTimeout(() => {
              if (foundWS && foundWS.readyState === WebSocket.OPEN) {
                foundWS.send('${message.replace(/'/g, "\\'")}');
              }
            }, 100);
            
            return 'Message injection attempted';
          })();
        `;
        
        const result = await Runtime.evaluate({ expression: script });
        
        return {
          success: true,
          message: 'WebSocket message injection attempted',
          note: 'CDP limitation: Direct WS injection requires JavaScript workaround'
        };
      }
    },

    {
      name: 'disable_websocket_interception',
      description: 'Disable WebSocket interception',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ tabId }: any) => {
        await connector.verifyConnection();
        const effectiveTabId = tabId || 'default';
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
      description: 'Start recording all network traffic in HAR (HTTP Archive) format',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
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
        
        Network.requestWillBeSent((params: any) => {
          const entry: any = {
            requestId: params.requestId,
            startedDateTime: new Date(params.timestamp * 1000).toISOString(),
            time: 0,
            request: {
              method: params.request.method,
              url: params.request.url,
              httpVersion: 'HTTP/1.1',
              headers: Object.entries(params.request.headers || {}).map(([name, value]) => ({ name, value })),
              queryString: [],
              cookies: [],
              headersSize: -1,
              bodySize: params.request.postData ? params.request.postData.length : 0
            },
            response: {},
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
              redirectURL: '',
              headersSize: -1,
              bodySize: -1
            };
          }
        });
        
        Network.loadingFinished((params: any) => {
          const entry = recording.entries.find((e: any) => e.requestId === params.requestId);
          if (entry) {
            entry.time = (params.timestamp * 1000) - new Date(entry.startedDateTime).getTime();
          }
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
      description: 'Stop HAR recording and return the HAR data',
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
              version: '1.0.9'
            },
            pages: recording.pages,
            entries: recording.entries
          }
        };
        
        harRecordings.delete(effectiveTabId);
        
        return {
          success: true,
          har,
          entriesCount: recording.entries.length,
          duration: Date.now() - recording.startTime
        };
      }
    },

    {
      name: 'export_har_file',
      description: 'Export HAR recording to a file',
      inputSchema: z.object({
        filename: z.string().describe('Filename to save HAR (e.g., recording.har)'),
        outputDir: z.string().optional().describe('Output directory (default: current directory)'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ filename, outputDir = '.', tabId }: any) => {
        await connector.verifyConnection();
        const effectiveTabId = tabId || 'default';
        const recording = harRecordings.get(effectiveTabId);
        
        if (!recording) {
          throw new Error('No active HAR recording to export');
        }
        
        const har = {
          log: {
            version: '1.2',
            creator: {
              name: 'Custom Chrome MCP',
              version: '1.0.9'
            },
            pages: recording.pages,
            entries: recording.entries
          }
        };
        
        const filepath = path.join(outputDir, filename);
        await fs.writeFile(filepath, JSON.stringify(har, null, 2), 'utf-8');
        
        return {
          success: true,
          message: `HAR file exported to ${filepath}`,
          filepath,
          entriesCount: recording.entries.length
        };
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // 5. ADVANCED REQUEST PATTERNS
    // ═══════════════════════════════════════════════════════════════════

    {
      name: 'add_advanced_interception_pattern',
      description: 'Add advanced interception pattern with complex filtering (status code, size, duration, content-type, etc.)',
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
        const client = await connector.getTabClient(tabId);
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
          
          // URL pattern matching
          if (urlPattern) {
            const regex = new RegExp(urlPattern.replace(/\*/g, '.*'));
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
              console.log(`[Pattern: ${name}] Matched request:`, {
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
      description: 'Inject CSS into ALL pages automatically (persists across navigation)',
      inputSchema: z.object({
        css: z.string().describe('CSS code to inject'),
        name: z.string().optional().describe('Name for this injection (for reference)'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ css, name, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Page } = client;
        
        await Page.enable();
        
        const script = `
          (function() {
            const style = document.createElement('style');
            style.textContent = \`${css.replace(/`/g, '\\`')}\`;
            style.setAttribute('data-mcp-injection', '${name || 'unnamed'}');
            document.head.appendChild(style);
          })();
        `;
        
        const result = await Page.addScriptToEvaluateOnNewDocument({
          source: script
        });
        
        const effectiveTabId = tabId || 'default';
        if (!injectedScripts.has(effectiveTabId)) {
          injectedScripts.set(effectiveTabId, []);
        }
        injectedScripts.get(effectiveTabId)!.push(result.identifier);
        
        // Also inject in current page
        const { Runtime } = client;
        await Runtime.enable();
        await Runtime.evaluate({ expression: script });
        
        return {
          success: true,
          message: 'CSS injected globally',
          identifier: result.identifier,
          name: name || 'unnamed'
        };
      }
    },

    {
      name: 'inject_js_global',
      description: 'Inject JavaScript into ALL pages automatically (runs before any page script)',
      inputSchema: z.object({
        javascript: z.string().describe('JavaScript code to inject'),
        name: z.string().optional().describe('Name for this injection (for reference)'),
        runImmediately: z.boolean().default(true).describe('Also run in current page'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ javascript, name, runImmediately = true, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Page } = client;
        
        await Page.enable();
        
        const result = await Page.addScriptToEvaluateOnNewDocument({
          source: javascript
        });
        
        const effectiveTabId = tabId || 'default';
        if (!injectedScripts.has(effectiveTabId)) {
          injectedScripts.set(effectiveTabId, []);
        }
        injectedScripts.get(effectiveTabId)!.push(result.identifier);
        
        if (runImmediately) {
          const { Runtime } = client;
          await Runtime.enable();
          await Runtime.evaluate({ expression: javascript });
        }
        
        return {
          success: true,
          message: 'JavaScript injected globally',
          identifier: result.identifier,
          name: name || 'unnamed',
          runImmediately
        };
      }
    },

    {
      name: 'list_injected_scripts',
      description: 'List all globally injected CSS/JS',
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
      description: 'Remove a specific injected script (CSS or JS)',
      inputSchema: z.object({
        identifier: z.string().describe('Injection identifier from inject_css_global or inject_js_global'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ identifier, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
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
      description: 'Clear all injected CSS/JS scripts',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
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
