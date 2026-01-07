/**
 * System-level Chrome Tools
 * For extensions, background workers, etc.
 */

import { z } from 'zod';
import type { ChromeConnector } from '../chrome-connector.js';
import CDP from 'chrome-remote-interface';

export function createSystemTools(connector: ChromeConnector) {
  return [
    // List all Chrome targets (including extension service workers)
    {
      name: 'list_all_targets',
      description: 'List all Chrome targets including extension service workers, background pages, and more',
      inputSchema: z.object({}),
      handler: async () => {
        const port = connector.getPort();
        const targets = await CDP.List({ port });
        
        // Categorize targets
        const pages = targets.filter((t: any) => t.type === 'page');
        const serviceWorkers = targets.filter((t: any) => t.type === 'service_worker');
        const backgroundPages = targets.filter((t: any) => t.type === 'background_page');
        const others = targets.filter((t: any) => 
          !['page', 'service_worker', 'background_page'].includes(t.type)
        );
        
        return {
          success: true,
          total: targets.length,
          breakdown: {
            pages: pages.length,
            serviceWorkers: serviceWorkers.length,
            backgroundPages: backgroundPages.length,
            others: others.length
          },
          targets: {
            pages: pages.map((t: any) => ({
              id: t.id,
              title: t.title,
              url: t.url,
              type: t.type
            })),
            serviceWorkers: serviceWorkers.map((t: any) => ({
              id: t.id,
              title: t.title,
              url: t.url,
              type: t.type,
              description: t.description
            })),
            backgroundPages: backgroundPages.map((t: any) => ({
              id: t.id,
              title: t.title,
              url: t.url,
              type: t.type
            })),
            others: others.map((t: any) => ({
              id: t.id,
              title: t.title,
              url: t.url,
              type: t.type
            }))
          }
        };
      }
    },

    // Connect to a specific target (like extension service worker)
    {
      name: 'connect_to_target',
      description: 'Connect to a specific Chrome target by ID (useful for extension service workers)',
      inputSchema: z.object({
        targetId: z.string().describe('Target ID to connect to')
      }),
      handler: async ({ targetId }: any) => {
        const port = connector.getPort();
        const client = await CDP({ port, target: targetId });
        
        const { Runtime } = client;
        await Runtime.enable();
        
        // Get some info about the target
        const result = await Runtime.evaluate({
          expression: 'typeof self + " - " + (self.location ? self.location.href : "no location")',
          returnByValue: true
        });
        
        await client.close();
        
        return {
          success: true,
          targetId,
          context: result.result.value,
          message: 'Successfully connected to target'
        };
      }
    },

    // Execute code in a specific target
    {
      name: 'execute_in_target',
      description: 'Execute JavaScript code in a specific target (extension service worker, etc.)',
      inputSchema: z.object({
        targetId: z.string().describe('Target ID'),
        script: z.string().describe('JavaScript code to execute'),
        awaitPromise: z.boolean().optional().default(false).describe('Wait for promise')
      }),
      handler: async ({ targetId, script, awaitPromise }: any) => {
        const port = connector.getPort();
        const client = await CDP({ port, target: targetId });
        
        const { Runtime } = client;
        await Runtime.enable();
        
        const result = await Runtime.evaluate({
          expression: script,
          awaitPromise,
          returnByValue: true
        });
        
        await client.close();
        
        if (result.exceptionDetails) {
          throw new Error(`Script execution failed: ${result.exceptionDetails.text}`);
        }
        
        return {
          success: true,
          result: result.result.value,
          type: result.result.type
        };
      }
    },

    // Get extension service worker details
    {
      name: 'get_extension_service_workers',
      description: 'Get all extension service workers with detailed information',
      inputSchema: z.object({}),
      handler: async () => {
        const port = connector.getPort();
        const targets = await CDP.List({ port });
        
        const serviceWorkers = targets.filter((t: any) => t.type === 'service_worker');
        
        const details = await Promise.all(
          serviceWorkers.map(async (sw: any) => {
            try {
              const client = await CDP({ port, target: sw.id });
              const { Runtime } = client;
              await Runtime.enable();
              
              // Try to get extension info
              const info = await Runtime.evaluate({
                expression: `
                  JSON.stringify({
                    hasChrome: typeof chrome !== 'undefined',
                    hasRuntime: typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined',
                    extensionId: typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime.id : null
                  })
                `,
                returnByValue: true
              });
              
              await client.close();
              
              const extInfo = JSON.parse(info.result.value || '{}');
              
              return {
                id: sw.id,
                title: sw.title,
                url: sw.url,
                description: sw.description,
                extensionId: extInfo.extensionId,
                hasChrome: extInfo.hasChrome,
                hasRuntime: extInfo.hasRuntime
              };
            } catch (error) {
              return {
                id: sw.id,
                title: sw.title,
                url: sw.url,
                error: (error as Error).message
              };
            }
          })
        );
        
        return {
          success: true,
          count: details.length,
          serviceWorkers: details
        };
      }
    }
  ];
}
