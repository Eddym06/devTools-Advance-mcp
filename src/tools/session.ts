/**
 * Cookie and Session Management Tools
 */

import { z } from 'zod';
import type { ChromeConnector } from '../chrome-connector.js';
import type { SessionData } from '../types/index.js';

export function createSessionTools(connector: ChromeConnector) {
  return [
    // Get cookies
    {
      name: 'get_cookies',
      description: '🍪 Retrieves browser cookies. USE THIS WHEN: 1️⃣ Login successful but still seeing login page (check auth cookie exists). 2️⃣ Session not persisting across refreshes (verify session cookie). 3️⃣ Features unavailable despite authentication (check auth token value). 4️⃣ Debugging third-party integrations (check tracking cookies). WHY CRITICAL: Many auth/session issues are cookie-related (expired, wrong domain, missing httpOnly flag). Cookies contain hidden auth data NOT visible in HTML. COMMON FIXES: Missing cookie = login failed silently, Expired cookie = re-login needed, Wrong domain = CORS/subdomain issue.',
      inputSchema: z.object({
        url: z.string().optional().describe('URL to get cookies for (optional, uses current page if not specified)'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ url, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Network } = client;
        
        await Network.enable();
        
        const params: any = {};
        if (url) params.urls = [url];
        
        const { cookies } = await Network.getCookies(params);
        
        return {
          success: true,
          count: cookies.length,
          cookies: cookies.map((c: any) => ({
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path,
            expires: c.expires,
            httpOnly: c.httpOnly,
            secure: c.secure,
            sameSite: c.sameSite
          }))
        };
      }
    },

    // Set cookie
    {
      name: 'set_cookie',
      description: '🔧 Creates/modifies cookies. USE THIS WHEN: 1️⃣ Simulating logged-in state (inject auth cookie). 2️⃣ Bypassing login for testing (set session cookie directly). 3️⃣ Testing authenticated features without full login flow. 4️⃣ Transferring session from one browser to another. 5️⃣ Setting up test environment with specific state. PARAMETERS: domain (auto-detected if omitted), secure/httpOnly flags important for auth cookies. CAUTION: Cookie must match domain rules (no cross-domain cookies).',
      inputSchema: z.object({
        name: z.string().describe('Cookie name'),
        value: z.string().describe('Cookie value'),
        domain: z.string().optional().describe('Cookie domain'),
        path: z.string().default('/').describe('Cookie path'),
        secure: z.boolean().default(false).describe('Secure flag'),
        httpOnly: z.boolean().default(false).describe('HttpOnly flag'),
        sameSite: z.enum(['Strict', 'Lax', 'None']).optional().describe('SameSite attribute'),
        expires: z.number().optional().describe('Expiration timestamp'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ name, value, domain, path, secure, httpOnly, sameSite, expires, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Network } = client;
        
        await Network.enable();
        
        // Get current domain if not specified
        if (!domain) {
          const { Runtime } = client;
          await Runtime.enable();
          const result = await Runtime.evaluate({
            expression: 'window.location.hostname'
          });
          domain = result.result.value;
        }
        
        const cookie: any = {
          name,
          value,
          domain,
          path,
          secure,
          httpOnly
        };
        
        if (sameSite) cookie.sameSite = sameSite;
        if (expires) cookie.expires = expires;
        
        const { success } = await Network.setCookie(cookie);
        
        if (!success) {
          throw new Error('Failed to set cookie');
        }
        
        return {
          success: true,
          cookie: { name, value, domain },
          message: `Cookie "${name}" set successfully`
        };
      }
    },

    // Delete cookie
    {
      name: 'delete_cookie',
      description: '🗑️ Deletes specific cookie by name. USE THIS WHEN: 1️⃣ Logging out (delete session/auth cookies). 2️⃣ Testing without login (remove auth cookie). 3️⃣ Resetting specific state (tracking, preferences). 4️⃣ Debugging cookie issues (remove problematic cookie). PARAMETERS: name (required), domain (auto-detects if omitted), path (default: "/"). TIP: Use get_cookies first to see exact name/domain. EFFECT: Cookie deleted, may trigger logout or state reset.',
      inputSchema: z.object({
        name: z.string().describe('Cookie name to delete'),
        domain: z.string().optional().describe('Cookie domain (optional, uses current domain if not specified)'),
        path: z.string().default('/').describe('Cookie path'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ name, domain, path, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Network } = client;
        
        await Network.enable();
        
        // Get current domain if not specified
        if (!domain) {
          const { Runtime } = client;
          await Runtime.enable();
          const result = await Runtime.evaluate({
            expression: 'window.location.hostname'
          });
          domain = result.result.value;
        }
        
        await Network.deleteCookies({ name, domain, path });
        
        return {
          success: true,
          message: `Cookie "${name}" deleted`
        };
      }
    },

    // Clear all cookies
    {
      name: 'clear_cookies',
      description: '🧹 Clears ALL cookies (current domain or all domains). USE THIS WHEN: 1️⃣ Full logout (remove all auth). 2️⃣ Starting fresh test (clean slate). 3️⃣ Debugging cookie conflicts (eliminate all cookies). 4️⃣ Privacy cleanup (remove tracking). PARAMETERS: domain (specific domain) or omit (clear ALL domains). WARNING: domain=null clears EVERYTHING across all sites. EFFECT: Complete logout, lost preferences, tracking reset.',
      inputSchema: z.object({
        allDomains: z.boolean().default(false).describe('Clear cookies for all domains'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ allDomains, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Network } = client;
        
        await Network.enable();
        
        if (allDomains) {
          await Network.clearBrowserCookies();
          return {
            success: true,
            message: 'All cookies cleared from all domains'
          };
        } else {
          // Clear only current domain cookies
          const { cookies } = await Network.getCookies();
          
          for (const cookie of cookies) {
            await Network.deleteCookies({
              name: cookie.name,
              domain: cookie.domain,
              path: cookie.path
            });
          }
          
          return {
            success: true,
            count: cookies.length,
            message: `Cleared ${cookies.length} cookies from current domain`
          };
        }
      }
    },

    // Get localStorage
    {
      name: 'get_local_storage',
      description: '💾 Retrieves all localStorage items (key-value pairs). USE THIS WHEN: 1️⃣ Debugging state issues (see stored data). 2️⃣ Inspecting app data (user prefs, cached content). 3️⃣ Verifying save worked (check data persisted). 4️⃣ Extracting session info (auth tokens, user data). RETURNS: Object with all keys/values, count. COMMON KEYS: auth tokens, user settings, cached API responses. TIP: Use set_local_storage to modify values.',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Runtime } = client;
        
        await Runtime.enable();
        
        const result = await Runtime.evaluate({
          expression: 'JSON.stringify(Object.assign({}, localStorage))',
          returnByValue: true
        });
        
        const storage = JSON.parse(result.result.value || '{}');
        
        return {
          success: true,
          count: Object.keys(storage).length,
          storage
        };
      }
    },

    // Set localStorage item
    {
      name: 'set_local_storage',
      description: '✏️ Sets localStorage key-value pair. USE THIS WHEN: 1️⃣ Injecting auth tokens (bypass login). 2️⃣ Setting user preferences (theme, language). 3️⃣ Fixing state issues (force specific value). 4️⃣ Testing with mock data (inject test values). PARAMETERS: key (string), value (string - use JSON.stringify for objects). PERSISTENT: Survives page refresh, NOT navigation to other domains. TIP: Refresh page after setting to see effect.',
      inputSchema: z.object({
        key: z.string().describe('Storage key'),
        value: z.string().describe('Storage value'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ key, value, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Runtime } = client;
        
        await Runtime.enable();
        
        await Runtime.evaluate({
          expression: `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)})`
        });
        
        return {
          success: true,
          message: `localStorage item "${key}" set successfully`
        };
      }
    },

    // Clear localStorage
    {
      name: 'clear_local_storage',
      description: '🗑️ Deletes ALL localStorage items for current domain. USE THIS WHEN: 1️⃣ Resetting app state (start fresh). 2️⃣ Fixing corrupt data (clear and reload). 3️⃣ Testing first-time experience (simulate new user). 4️⃣ Debugging state issues (eliminate cached data). WARNING: Removes ALL keys - may log out user, lose preferences. SCOPE: Only current domain (other sites unaffected). TIP: Use get_local_storage first to backup data.',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Runtime } = client;
        
        await Runtime.enable();
        
        await Runtime.evaluate({
          expression: 'localStorage.clear()'
        });
        
        return {
          success: true,
          message: 'localStorage cleared'
        };
      }
    },

    // Export session
    {
      name: 'export_session',
      description: '📦 Exports complete session state (cookies, localStorage, sessionStorage). USE THIS WHEN: 1️⃣ Saving logged-in state (restore later without re-login). 2️⃣ Transferring session (move to another browser/machine). 3️⃣ Backup before testing (save state, test, restore). 4️⃣ Debugging session issues (analyze all session data). RETURNS: JSON with all cookies, localStorage, sessionStorage. WORKFLOW: export_session → save JSON → import_session to restore.',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Network, Runtime } = client;
        
        await Network.enable();
        await Runtime.enable();
        
        // Get cookies
        const { cookies } = await Network.getCookies();
        
        // Get localStorage
        const localStorageResult = await Runtime.evaluate({
          expression: 'JSON.stringify(Object.assign({}, localStorage))',
          returnByValue: true
        });
        
        // Get sessionStorage
        const sessionStorageResult = await Runtime.evaluate({
          expression: 'JSON.stringify(Object.assign({}, sessionStorage))',
          returnByValue: true
        });
        
        const sessionData: SessionData = {
          cookies: cookies.map((c: any) => ({
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path,
            expires: c.expires,
            httpOnly: c.httpOnly,
            secure: c.secure,
            sameSite: c.sameSite as any
          })),
          localStorage: JSON.parse(localStorageResult.result.value || '{}'),
          sessionStorage: JSON.parse(sessionStorageResult.result.value || '{}'),
          timestamp: Date.now()
        };
        
        return {
          success: true,
          session: sessionData,
          message: 'Session exported successfully'
        };
      }
    },

    // Import session
    {
      name: 'import_session',
      description: '📥 Imports previously exported session (restores cookies, storage). USE THIS WHEN: 1️⃣ Restoring logged-in state (skip login with saved session). 2️⃣ Transferring session (from export_session). 3️⃣ Testing with specific state (restore known-good session). 4️⃣ Automating login (save session once, reuse forever). PREREQUISITE: Get sessionData JSON from export_session. EFFECT: Sets all cookies, localStorage, sessionStorage. TIP: Navigate after import to activate session.',
      inputSchema: z.object({
        sessionData: z.string().describe('Session data as JSON string'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ sessionData, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Network, Runtime } = client;
        
        await Network.enable();
        await Runtime.enable();
        
        const session: SessionData = JSON.parse(sessionData);
        
        // Import cookies
        for (const cookie of session.cookies) {
          await Network.setCookie(cookie as any);
        }
        
        // Import localStorage
        for (const [key, value] of Object.entries(session.localStorage)) {
          await Runtime.evaluate({
            expression: `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)})`
          });
        }
        
        // Import sessionStorage
        for (const [key, value] of Object.entries(session.sessionStorage)) {
          await Runtime.evaluate({
            expression: `sessionStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)})`
          });
        }
        
        return {
          success: true,
          imported: {
            cookies: session.cookies.length,
            localStorage: Object.keys(session.localStorage).length,
            sessionStorage: Object.keys(session.sessionStorage).length
          },
          message: 'Session imported successfully'
        };
      }
    }
  ];
}
