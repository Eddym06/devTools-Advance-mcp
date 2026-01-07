/**
 * Service Worker Management Tools
 */

import { z } from 'zod';
import type { ChromeConnector } from '../chrome-connector';
import type { ServiceWorkerInfo } from '../types/index';

export function createServiceWorkerTools(connector: ChromeConnector) {
  return [
    // List all service workers
    {
      name: 'list_service_workers',
      description: 'List all registered service workers',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ tabId }: any) => {
        const client = await connector.getTabClient(tabId);
        const { ServiceWorker } = client;
        
        await ServiceWorker.enable();
        
        const { registrations } = await ServiceWorker.getRegistrations();
        
        const workers: ServiceWorkerInfo[] = registrations.map((reg: any) => ({
          registrationId: reg.registrationId,
          scopeURL: reg.scopeURL,
          scriptURL: reg.scriptURL || '',
          status: reg.status || 'unknown',
          versionId: reg.versionId || '',
          runningStatus: reg.runningStatus
        }));
        
        return {
          success: true,
          count: workers.length,
          workers
        };
      }
    },

    // Get service worker details
    {
      name: 'get_service_worker',
      description: 'Get detailed information about a specific service worker',
      inputSchema: z.object({
        versionId: z.string().describe('Service worker version ID'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ versionId, tabId }: any) => {
        const client = await connector.getTabClient(tabId);
        const { ServiceWorker } = client;
        
        await ServiceWorker.enable();
        
        const { registrations } = await ServiceWorker.getRegistrations();
        const worker = registrations.find((r: any) => r.versionId === versionId);
        
        if (!worker) {
          throw new Error(`Service worker not found: ${versionId}`);
        }
        
        return {
          success: true,
          worker: {
            registrationId: worker.registrationId,
            scopeURL: worker.scopeURL,
            scriptURL: worker.scriptURL,
            status: worker.status,
            versionId: worker.versionId,
            runningStatus: worker.runningStatus
          }
        };
      }
    },

    // Unregister service worker
    {
      name: 'unregister_service_worker',
      description: 'Unregister a service worker by scope URL',
      inputSchema: z.object({
        scopeURL: z.string().describe('Scope URL of the service worker to unregister'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ scopeURL, tabId }: any) => {
        const client = await connector.getTabClient(tabId);
        const { ServiceWorker } = client;
        
        await ServiceWorker.enable();
        await ServiceWorker.unregister({ scopeURL });
        
        return {
          success: true,
          message: `Service worker unregistered: ${scopeURL}`
        };
      }
    },

    // Update service worker
    {
      name: 'update_service_worker',
      description: 'Force update a service worker registration',
      inputSchema: z.object({
        scopeURL: z.string().describe('Scope URL of the service worker to update'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ scopeURL, tabId }: any) => {
        const client = await connector.getTabClient(tabId);
        const { ServiceWorker } = client;
        
        await ServiceWorker.enable();
        await ServiceWorker.updateRegistration({ scopeURL });
        
        return {
          success: true,
          message: `Service worker update triggered: ${scopeURL}`
        };
      }
    },

    // Start service worker
    {
      name: 'start_service_worker',
      description: 'Start a service worker',
      inputSchema: z.object({
        scopeURL: z.string().describe('Scope URL of the service worker to start'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ scopeURL, tabId }: any) => {
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
      description: 'Stop a running service worker',
      inputSchema: z.object({
        versionId: z.string().describe('Version ID of the service worker to stop'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ versionId, tabId }: any) => {
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
      description: 'Open DevTools for a service worker',
      inputSchema: z.object({
        versionId: z.string().describe('Version ID of the service worker to inspect'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ versionId, tabId }: any) => {
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
      description: 'Skip waiting phase for a service worker',
      inputSchema: z.object({
        scopeURL: z.string().describe('Scope URL of the service worker'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ scopeURL, tabId }: any) => {
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
      description: 'Get cache names used by service workers',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ tabId }: any) => {
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
