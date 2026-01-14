/**
 * Navigation and Tab Management Tools
 */

import { z } from 'zod';
import type { ChromeConnector } from '../chrome-connector.js';
import { isValidUrl, humanDelay, withTimeout } from '../utils/helpers.js';

export function createNavigationTools(connector: ChromeConnector) {
  return [
    // Consolidated Browser Action Tool
    {
      name: 'browser_action',
      description: '🌐 Controls basic browser navigation. USE THIS for: navigating, going back/forward, or reloading. Combines features of simple navigation. ACTIONS: "navigate" (go to URL), "back" (go back in history), "forward" (go forward), "reload" (refresh page).',
      inputSchema: z.object({
        action: z.enum(['navigate', 'back', 'forward', 'reload']).describe('Action to perform'),
        url: z.string().optional().describe('URL to navigate to (REQUIRED for action="navigate")'),
        tabId: z.string().optional().describe('Tab ID (optional)'),
        waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).default('load').describe('Wait condition (for navigate/reload)'),
        timeout: z.number().default(30000).describe('Timeout in milliseconds')
      }),
      handler: async ({ action, url, tabId, waitUntil = 'load', timeout = 30000 }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Page, Network } = client;
        
        await Promise.all([Page.enable(), Network.enable()]);

        if (action === 'navigate') {
            if (!url) throw new Error('URL is required for "navigate" action');
            const targetUrl = url; // TS check
            console.error(`[Browser Action] Navigating to ${targetUrl}`);
            
            // Wait Logic (Duplicated for robustness)
            let loadPromise: Promise<any>;
            
            if (waitUntil === 'networkidle') {
                loadPromise = new Promise<void>((resolve, reject) => {
                    let pendingRequests = 0;
                    let lastRequestTime = Date.now();
                    let checkInterval: NodeJS.Timeout;
                    let timeoutId: NodeJS.Timeout;
                    let hasLoaded = false;
                    
                    Page.loadEventFired().then(() => { hasLoaded = true; });

                    const cleanup = () => {
                        clearInterval(checkInterval);
                        clearTimeout(timeoutId);
                    };

                    timeoutId = setTimeout(() => {
                        cleanup();
                        console.error('[Navigation] networkidle timeout, proceeding');
                        resolve();
                    }, timeout);

                    Network.requestWillBeSent(() => { pendingRequests++; lastRequestTime = Date.now(); });
                    const onRequestDone = () => { if (pendingRequests > 0) pendingRequests--; lastRequestTime = Date.now(); };
                    
                    Network.loadingFinished(onRequestDone);
                    Network.loadingFailed(onRequestDone);

                    checkInterval = setInterval(() => {
                        if (hasLoaded && pendingRequests === 0 && (Date.now() - lastRequestTime) > 500) {
                            cleanup();
                            resolve();
                        }
                    }, 100);
                });
            } else if (waitUntil === 'domcontentloaded') {
                loadPromise = Page.domContentEventFired();
            } else {
                loadPromise = Page.loadEventFired();
            }

            const navResponse = await Page.navigate({ url: targetUrl });
            if (navResponse.errorText) throw new Error(`Navigation failed: ${navResponse.errorText}`);
            
            await withTimeout(loadPromise, timeout, `Timeout waiting for ${waitUntil}`);
            await humanDelay();
            return { success: true, message: `Navigated to ${targetUrl}` };
        }

        if (action === 'back') {
            const history = await Page.getNavigationHistory();
            if (history.currentIndex > 0) {
                const entry = history.entries[history.currentIndex - 1];
                await Page.navigateToHistoryEntry({ entryId: entry.id });
                await humanDelay();
                return { success: true, message: 'Navigated back' };
            }
            return { success: false, message: 'No history to go back' };
        }

        if (action === 'forward') {
            const history = await Page.getNavigationHistory();
            if (history.currentIndex < history.entries.length - 1) {
                const entry = history.entries[history.currentIndex + 1];
                await Page.navigateToHistoryEntry({ entryId: entry.id });
                await humanDelay();
                return { success: true, message: 'Navigated forward' };
            }
            return { success: false, message: 'No history to go forward' };
        }

        if (action === 'reload') {
            await Page.reload({ ignoreCache: false });
            await Page.loadEventFired();
            return { success: true, message: 'Page reloaded' };
        }

        throw new Error(`Unknown action: ${action}`);
      }
    },
    
    // Consolidated Tab Management Tool
    {
      name: 'manage_tabs',
      description: '📑 Manages browser tabs. ACTIONS: "list" (show all), "create" (new tab), "close" (close tab), "switch" (focus tab), "get_url" (current URL). USE THIS instead of individual tools. ID required for close/switch.',
      inputSchema: z.object({
        action: z.enum(['list', 'create', 'close', 'switch', 'get_url']).describe('Action to perform'),
        url: z.string().optional().describe('URL for new tab (action="create")'),
        tabId: z.string().optional().describe('Tab ID (required for close/switch, optional for get_url)')
      }),
      handler: async ({ action, url, tabId }: any) => {
        await connector.verifyConnection();
        
        if (action === 'list') {
            const tabs = await connector.listTabs();
            return { success: true, count: tabs.length, tabs: tabs.map(t => ({ id: t.id, title: t.title, url: t.url })) };
        }
        
        if (action === 'create') {
            const newTab = await connector.createTab(url);
            await humanDelay();
            return { success: true, tab: { id: newTab.id, url: newTab.url }, message: `Created tab` };
        }
        
        if (action === 'close') {
            if (!tabId) throw new Error('Tab ID required for "close"');
            await connector.closeTab(tabId);
            return { success: true, message: `Closed tab ${tabId}` };
        }
        
        if (action === 'switch') {
            if (!tabId) throw new Error('Tab ID required for "switch"');
            await connector.activateTab(tabId);
            return { success: true, message: `Switched to ${tabId}` };
        }
        
        if (action === 'get_url') {
            const client = await connector.getTabClient(tabId);
            await client.Page.enable();
            const { frameTree } = await client.Page.getFrameTree();
            return { success: true, url: frameTree.frame.url, title: frameTree.frame.name || 'Untitled' };
        }

        throw new Error(`Unknown action: ${action}`);
      }
    },

    // Wait for load state (Kept separate as it's a utility waiting tool)
    {
      name: 'wait_for_load_state',
      description: '⏳ Waits for page to reach a specific state (load, networkidle, domcontentloaded). USE THIS WHEN: 1️⃣ After clicking a link/button that loads a new page. 2️⃣ After navigation to ensure page is ready. 3️⃣ When "get_html" returns incomplete content. STATES: "load" (default, page fully loaded), "domcontentloaded" (HTML ready), "networkidle" (no network activity for 500ms - useful for SPAs).',
      inputSchema: z.object({
        state: z.enum(['load', 'domcontentloaded', 'networkidle']).default('load').describe('State to wait for'),
        timeout: z.number().default(30000).describe('Timeout in milliseconds'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ state = 'load', timeout = 30000, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Page, Network } = client;
        
        await Page.enable();

        if (state === 'networkidle') {
           await Network.enable();
             // Primitive network idle implementation for CDP
            await new Promise<void>((resolve, reject) => {
                let pendingRequests = 0;
                let lastRequestTime = Date.now();
                let checkInterval: NodeJS.Timeout;
                let timeoutId: NodeJS.Timeout;

                const cleanup = () => {
                    clearInterval(checkInterval);
                    clearTimeout(timeoutId);
                };

                timeoutId = setTimeout(() => {
                    cleanup();
                    // Don't fail hard on network idle, just resolve with warning
                    console.error('[wait_for_load_state] networkidle timeout, proceeding anyway');
                    resolve();
                }, timeout);

                Network.requestWillBeSent(() => {
                    pendingRequests++;
                    lastRequestTime = Date.now();
                });

                const onRequestDone = () => {
                    if (pendingRequests > 0) pendingRequests--;
                    lastRequestTime = Date.now();
                };

                Network.loadingFinished(onRequestDone);
                Network.loadingFailed(onRequestDone);

                checkInterval = setInterval(() => {
                    // Wait for 0 pending requests and 500ms of silence
                    if (pendingRequests === 0 && (Date.now() - lastRequestTime) > 500) {
                        cleanup();
                        resolve();
                    }
                }, 100);
            });
        } else if (state === 'domcontentloaded') {
           await withTimeout(Page.domContentEventFired(), timeout, 'Wait for domcontentloaded timed out');
        } else {
           // 'load' state
           await withTimeout(Page.loadEventFired(), timeout, 'Wait for load timed out');
        }
        
        return {
          success: true,
          message: `Waited for state: ${state}`
        };
      }
    },
  ];
}
