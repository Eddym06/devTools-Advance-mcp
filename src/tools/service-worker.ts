/**
 * Service Worker Management Tools
 */

import { z } from 'zod';
import CDP from 'chrome-remote-interface';
import type { ChromeConnector } from '../chrome-connector.js';

export function createServiceWorkerTools(connector: ChromeConnector) {
  return [
    // List all service workers
    {
      name: 'list_service_workers',
      description:
        'List every Service Worker target currently visible to CDP (extension and web). ' +
        'NOTE: navigator.serviceWorker.getRegistrations() in a page can only see that page\'s own origin, ' +
        'so this lists actual CDP targets instead — every worker, cross-origin included.',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ tabId }: any) => {
        await connector.verifyConnection();
        const targets: any[] = await CDP.List({ port: connector.getPort() });

        const workers = targets
          .filter((t: any) => t.type === 'service_worker')
          .map((t: any) => ({
            id: t.id,
            url: t.url,
            title: t.title || '',
            description: t.description || '',
            scopeURL: t.url, // CDP lists the SW script URL as its target URL
          }));

        return {
          success: true,
          count: workers.length,
          workers,
          note:
            workers.length === 0
              ? 'No service worker targets found. They must be running (or start them with start_service_worker).'
              : 'Targets may be sleeping; use start_service_worker/inspect_service_worker to wake and debug a specific one.'
        };
      }
    },

    // Inspect service worker console logs
    {
      name: 'inspect_service_worker_logs',
      description: 'Capture console logs from a Service Worker by targetId for debugging.',
      inputSchema: z.object({
        targetId: z.string().describe('The Target ID of the service worker (from list_tabs)'),
        executeTestLogs: z.boolean().default(false).describe('Whether to inject test console.log statements to verify capture (default: false — do not pollute real logs)'),
        captureTimeMs: z.number().default(3000).describe('How long to listen for logs in milliseconds (default: 3000)')
      }),
      handler: async ({ targetId, executeTestLogs = false, captureTimeMs = 3000 }: any) => {
        await connector.verifyConnection();
        // Connect directly to the specific target
        const client = await connector.getTabClient(targetId);
        const { Runtime, Log } = client;
        
        await Runtime.enable();
        await Log.enable();
        
        // Collect logs from BOTH Runtime and Log domains for better coverage
        const logs: Array<{time: string, source: string, type: string, message: string}> = [];
        
        // Listen to Runtime.consoleAPICalled (for console.log/warn/error)
        client.on('Runtime.consoleAPICalled', (params: any) => {
             try {
                 const message = params.args.map((a:any) => {
                     if (a.value !== undefined) return String(a.value);
                     if (a.description) return a.description;
                     if (a.preview?.properties) {
                         return JSON.stringify(Object.fromEntries(
                             a.preview.properties.map((p:any) => [p.name, p.value])
                         ));
                     }
                     return '[Complex Object]';
                 }).join(' ');
                 
                 logs.push({
                     time: new Date().toISOString(),
                     source: 'Runtime.consoleAPICalled',
                     type: params.type || 'log',
                     message
                 });
             } catch (e) {
                 logs.push({
                     time: new Date().toISOString(),
                     source: 'Runtime.consoleAPICalled',
                     type: 'error',
                     message: `Failed to parse console args: ${e}`
                 });
             }
        });
        
        // Listen to Log.entryAdded (alternative logging mechanism)
        client.on('Log.entryAdded', (params: any) => {
             logs.push({
                 time: new Date(params.entry.timestamp).toISOString(),
                 source: 'Log.entryAdded',
                 type: params.entry.level || 'info',
                 message: params.entry.text || params.entry.url || 'Unknown log'
             });
        });

        // Get initial status
        const evalResult = await Runtime.evaluate({
            expression: `(function() {
                return {
                    userAgent: navigator.userAgent,
                    time: new Date().toISOString(),
                    location: self.location.href,
                    serviceWorker: {
                        state: self.serviceWorker ? self.serviceWorker.state : 'unknown'
                    }
                };
            })()`,
            returnByValue: true
        });

        // Execute test logs if requested (AFTER listeners are set up)
        if (executeTestLogs) {
            await Runtime.evaluate({
                expression: `
                    console.log('🔍 [MCP Test 1] Service Worker Log Capture Test');
                    console.warn('⚠️ [MCP Test 2] Warning level test');
                    console.error('❌ [MCP Test 3] Error level test');
                    console.log('✅ [MCP Test 4] Capture timestamp:', new Date().toISOString());
                `,
                awaitPromise: false
            });
        }

        // Wait to capture logs
        await new Promise(r => setTimeout(r, captureTimeMs));
        
        return {
          success: true,
          targetId,
          status: evalResult.result.value,
          capturedLogs: logs.length > 0 ? logs : [],
          summary: {
              totalCaptured: logs.length,
              byType: logs.reduce((acc: any, log) => {
                  acc[log.type] = (acc[log.type] || 0) + 1;
                  return acc;
              }, {}),
              bySource: logs.reduce((acc: any, log) => {
                  acc[log.source] = (acc[log.source] || 0) + 1;
                  return acc;
              }, {})
          },
          note: logs.length === 0 ? 
              "No logs captured. Service Worker extensions may have limited console.log emission via CDP. Try using Log.entryAdded or check Chrome DevTools directly." :
              `Successfully captured ${logs.length} log entries. REMINDER: This targetId (${targetId}) is for the Service Worker. To click elements or execute DOM scripts, use the main PAGE/TAB ID from list_tabs, NOT this ID.`
        };
      }
    },
    
    // Get service worker details
    {
      name: 'get_service_worker',
      description:
        'Get info about a specific Service Worker registration. Accepts either the registration ID ' +
        '(from the ServiceWorker domain — see below) or a service_worker target ID from list_service_workers.',
      inputSchema: z.object({
        registrationId: z.string().optional().describe('Service worker registration ID'),
        targetId: z.string().optional().describe('service_worker target ID from list_service_workers / list_tabs'),
        scopeURL: z.string().optional().describe('Scope URL to search registrations by (alternative lookup)'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ registrationId, targetId, scopeURL, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { ServiceWorker } = client;

        await ServiceWorker.enable();
        const { registrations } = await ServiceWorker.getRegistrations();

        // Look up by registration ID or scope URL.
        const registration = (registrations as any[]).find(
          (r: any) =>
            (registrationId && r.registrationId === registrationId) ||
            (scopeURL && r.scopeURL === scopeURL)
        );

        if (registration) {
          return {
            success: true,
            worker: {
              registrationId: registration.registrationId,
              scopeURL: registration.scopeURL,
              isDeleted: registration.isDeleted === true,
            },
            note:
              'Registration-level info. Per-version status (running, activated, etc.) requires the ServiceWorker ' +
              'workerVersionUpdated events — use list_all_targets + inspect_service_worker_logs to debug a live worker.'
          };
        }

        // Fallback: the caller passed a target ID — return the CDP target info.
        if (targetId) {
          const targets: any[] = await CDP.List({ port: connector.getPort() });
          const target = targets.find((t: any) => t.id === targetId && t.type === 'service_worker');
          if (target) {
            return {
              success: true,
              worker: {
                targetId: target.id,
                scopeURL: target.url,
                scriptURL: target.url,
                title: target.title || '',
              }
            };
          }
          throw new Error(`No service_worker target found with id: ${targetId}`);
        }

        throw new Error(
          'Service worker not found. Provide registrationId (after ServiceWorker.enable() events) or a ' +
          'service_worker targetId from list_service_workers / list_all_targets.'
        );
      }
    },

    // Unregister service worker
    {
      name: 'unregister_service_worker',
      description:
        'Permanently remove a Service Worker registration by scopeURL (PERMANENT — the site will re-register it ' +
        'on its next visit). Uses the CDP ServiceWorker domain, so it works for ANY scope, not just the current tab origin.',
      inputSchema: z.object({
        scopeURL: z.string().describe('Scope URL of the service worker to unregister'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ scopeURL, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getPersistentClient(tabId);
        const { ServiceWorker } = client;

        await ServiceWorker.enable();
        const result: any = await ServiceWorker.unregister({ scopeURL });

        return {
          success: true,
          message: `Service worker unregistered (permanent): ${scopeURL}`,
          scopeURL,
          ...(result?.error ? { serverError: result.error } : {}),
        };
      }
    },

    // Update service worker
    {
      name: 'update_service_worker',
      description:
        'Force a Service Worker to check for updates immediately (CDP ServiceWorker domain — works for any scope).',
      inputSchema: z.object({
        scopeURL: z.string().describe('Scope URL of the service worker to update'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ scopeURL, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getPersistentClient(tabId);
        const { ServiceWorker } = client;

        await ServiceWorker.enable();
        await ServiceWorker.updateRegistration({ scopeURL });

        return {
          success: true,
          message: `Service worker update check triggered: ${scopeURL}`,
          scopeURL
        };
      }
    },

    // Start service worker
    {
      name: 'start_service_worker',
      description: 'Start a stopped Service Worker by scopeURL.',
      inputSchema: z.object({
        scopeURL: z.string().describe('Scope URL of the service worker to start'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ scopeURL, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { ServiceWorker } = client;
        
        await ServiceWorker.enable();
        await ServiceWorker.startWorker({ scopeURL });
        
        return {
          success: true,
          message: `Service worker started: ${scopeURL}`
        };
      }
    },

    // Stop service worker
    {
      name: 'stop_service_worker',
      description: 'Stop a running Service Worker by versionId.',
      inputSchema: z.object({
        versionId: z.string().describe('Version ID of the service worker to stop'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ versionId, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { ServiceWorker } = client;
        
        await ServiceWorker.enable();
        await ServiceWorker.stopWorker({ versionId });
        
        return {
          success: true,
          message: `Service worker stopped: ${versionId}`
        };
      }
    },

    // Inspect service worker
    {
      name: 'inspect_service_worker',
      description: 'Open Chrome DevTools for a Service Worker for visual debugging.',
      inputSchema: z.object({
        versionId: z.string().describe('Version ID of the service worker to inspect'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ versionId, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { ServiceWorker } = client;
        
        await ServiceWorker.enable();
        await ServiceWorker.inspectWorker({ versionId });
        
        return {
          success: true,
          message: `DevTools opened for service worker: ${versionId}`
        };
      }
    },

    // Skip waiting
    {
      name: 'skip_waiting',
      description: 'Activate a waiting Service Worker immediately, skipping the wait phase.',
      inputSchema: z.object({
        scopeURL: z.string().describe('Scope URL of the service worker'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ scopeURL, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { ServiceWorker } = client;
        
        await ServiceWorker.enable();
        await ServiceWorker.skipWaiting({ scopeURL });
        
        return {
          success: true,
          message: `Skip waiting triggered for: ${scopeURL}`
        };
      }
    },

    // Get service worker cache names
    {
      name: 'get_sw_caches',
      description: 'List cache names created by Service Workers.',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { CacheStorage } = client;
        
        const { caches } = await CacheStorage.requestCacheNames({
          securityOrigin: await getCurrentOrigin(client)
        });
        
        return {
          success: true,
          count: caches.length,
          caches: caches.map((c: any) => ({
            securityOrigin: c.securityOrigin,
            cacheName: c.cacheName,
            cacheId: c.cacheId
          }))
        };
      }
    }
  ];
}

// Helper function to get current origin
async function getCurrentOrigin(client: any): Promise<string> {
  const { Runtime } = client;
  await Runtime.enable();
  
  const result = await Runtime.evaluate({
    expression: 'window.location.origin'
  });
  
  return result.result.value;
}
