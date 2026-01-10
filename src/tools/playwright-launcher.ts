/**
 * Playwright Launcher Tool
 * Launch Chrome with user profile using Playwright
 */

import { z } from 'zod';
import type { ChromeConnector } from '../chrome-connector.js';

export function createPlaywrightLauncherTools(connector: ChromeConnector) {
  return [
    {
      name: 'launch_chrome_with_profile',
      description: '🚀 Launches Chrome with YOUR profile (cookies, extensions, sessions). USE THIS WHEN: 1️⃣ Starting automation (first tool to call). 2️⃣ Need existing login sessions (avoid re-login). 3️⃣ Testing with extensions enabled. 4️⃣ Keeping browsing history/bookmarks. PROFILES: "Default" (main), "Profile 1", "Profile 2". PREREQUISITE: Close ALL Chrome windows first (conflict error otherwise). RECOMMENDED: Always use this instead of connecting to external Chrome.',
      inputSchema: z.object({
        profileDirectory: z.string().default('Default').describe('Profile directory name: "Default", "Profile 1", "Profile 2", etc.'),
        userDataDir: z.string().optional().describe('Full path to Chrome User Data directory. Leave empty for default location.')
      }),
      handler: async ({ profileDirectory, userDataDir }: any) => {
        try {
          const options: any = {
            headless: false,
            profileDirectory
          };
          
          if (userDataDir) {
            options.userDataDir = userDataDir;
          }
          
          await connector.launchWithProfile(options);
          
          return {
            success: true,
            message: `Chrome launched with profile: ${profileDirectory}`,
            cdpPort: connector.getPort(),
            note: 'Chrome is now running with all your cookies, sessions, and extensions. Use other MCP tools to interact with it.'
          };
        } catch (error) {
          return {
            success: false,
            error: (error as Error).message,
            suggestion: 'Make sure Chrome is not already running. Close all Chrome windows and try again.'
          };
        }
      }
    },
    
    {
      name: 'launch_edge_with_profile',
      description: '🧭Launches Microsoft Edge with YOUR profile (Edge-specific). USE THIS WHEN: 1️⃣ Testing Edge-specific features. 2️⃣ Need Edge browser specifically (not Chrome). 3️⃣ Using Edge profile with saved logins. PROFILES: "Default", "Profile 1". PREREQUISITE: Close all Edge windows. NOTE: Most features work identically to Chrome (Chromium-based).',
      inputSchema: z.object({
        profileDirectory: z.string().default('Default').describe('Profile directory name')
      }),
      handler: async ({ profileDirectory }: any) => {
        try {
          const edgeUserData = `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\User Data`;
          const edgeExe = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
          
          await connector.launchWithProfile({
            headless: false,
            profileDirectory,
            userDataDir: edgeUserData,
            executablePath: edgeExe
          });
          
          return {
            success: true,
            message: `Edge launched with profile: ${profileDirectory}`,
            cdpPort: connector.getPort()
          };
        } catch (error) {
          return {
            success: false,
            error: (error as Error).message
          };
        }
      }
    },
    
    {
      name: 'close_browser',
      description: '🚪 Closes Playwright-managed browser (cleanup). USE THIS WHEN: 1️⃣ Done with automation session. 2️⃣ Want to release browser lock (launch again). 3️⃣ Cleaning up after testing. PREREQUISITE: Browser launched with launch_chrome_with_profile. EFFECT: Browser closes, profile unlocked. NOTE: Only works for Playwright-managed browsers (not external connections).',
      inputSchema: z.object({}),
      handler: async () => {
        try {
          if (!connector.isPlaywrightManaged()) {
            return {
              success: false,
              message: 'No Playwright-managed browser to close'
            };
          }
          
          await connector.disconnect();
          
          return {
            success: true,
            message: 'Browser closed successfully'
          };
        } catch (error) {
          return {
            success: false,
            error: (error as Error).message
          };
        }
      }
    },
    
    {
      name: 'get_browser_status',
      description: '📊 Checks browser connection status. USE THIS WHEN: 1️⃣ Verifying browser launched successfully. 2️⃣ Debugging connection issues. 3️⃣ Checking if Playwright-managed or external. RETURNS: connected (boolean), playwrightManaged (boolean), port (CDP port), status (string). STATES: "Running via Playwright", "Connected to external Chrome", "Not connected".',
      inputSchema: z.object({}),
      handler: async () => {
        const isConnected = connector.isConnected();
        const isPlaywright = connector.isPlaywrightManaged();
        
        return {
          success: true,
          connected: isConnected,
          playwrightManaged: isPlaywright,
          port: connector.getPort(),
          status: isConnected 
            ? (isPlaywright ? 'Running via Playwright' : 'Connected to external Chrome') 
            : 'Not connected'
        };
      }
    }
  ];
}
