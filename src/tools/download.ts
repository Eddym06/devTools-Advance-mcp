/**
 * File Download Tools
 *
 * Chrome only writes a download to disk once you explicitly opt the browser
 * process into it (Browser.setDownloadBehavior); by default CDP-controlled
 * Chrome silently drops downloads. This wires that up, clicks the trigger
 * element, and waits for the CDP download-progress events to report completion.
 */

import { z } from 'zod';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ChromeConnector } from '../chrome-connector.js';

export function createDownloadTools(connector: ChromeConnector) {
  return [
    {
      name: 'download_file',
      description:
        'Click an element that triggers a file download, wait for it to finish, and return the saved file path. ' +
        'Chrome does not save downloads by default when driven via CDP — this tool enables it for the duration of the call.',
      inputSchema: z.object({
        selector: z.string().describe('CSS selector of the element that triggers the download (link/button)'),
        downloadDir: z.string().optional().describe('Directory to save into (defaults to a temp folder)'),
        tabId: z.string().optional().describe('Tab ID (optional)'),
        timeoutMs: z.number().default(30000).describe('Max time to wait for the download to complete'),
      }),
      handler: async ({ selector, downloadDir, tabId, timeoutMs = 30000 }: any) => {
        await connector.verifyConnection();

        const dir = downloadDir || path.join(os.tmpdir(), 'chrome-mcp-downloads');
        fs.mkdirSync(dir, { recursive: true });

        // Download behavior is a browser-level setting, not per-target, so
        // it must go through the main connection rather than a tab session.
        const browserClient = connector.getConnection().client;
        await browserClient.send('Browser.setDownloadBehavior', {
          behavior: 'allow',
          downloadPath: dir,
          eventsEnabled: true,
        });

        const tabClient = await connector.getTabClient(tabId);
        const { Runtime } = tabClient;
        await Runtime.enable();

        let suggestedFilename: string | undefined;
        const onWillBegin = (params: any) => {
          suggestedFilename = params.suggestedFilename;
        };

        const downloadPromise = new Promise<string>((resolve, reject) => {
          const timeout = setTimeout(() => {
            cleanup();
            reject(new Error(`Download did not complete within ${timeoutMs}ms`));
          }, timeoutMs);

          const onProgress = (params: any) => {
            if (params.state === 'completed') {
              cleanup();
              clearTimeout(timeout);
              const filename = params.filePath ? path.basename(params.filePath) : suggestedFilename;
              if (!filename) {
                reject(new Error('Download completed but no filename was reported'));
                return;
              }
              resolve(filename);
            } else if (params.state === 'canceled') {
              cleanup();
              clearTimeout(timeout);
              reject(new Error('Download was canceled'));
            }
          };

          function cleanup() {
            browserClient.removeListener('Browser.downloadWillBegin', onWillBegin);
            browserClient.removeListener('Browser.downloadProgress', onProgress);
          }

          browserClient.on('Browser.downloadWillBegin', onWillBegin);
          browserClient.on('Browser.downloadProgress', onProgress);
        });

        const clickResult: any = await Runtime.evaluate({
          expression: `(function() {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) throw new Error('Element not found');
            el.click();
            return true;
          })()`,
          awaitPromise: true,
        });
        if (clickResult.exceptionDetails) {
          throw new Error(`Click failed: ${clickResult.exceptionDetails.exception?.description || 'unknown error'}`);
        }

        const filename = await downloadPromise;
        const filePath = path.join(dir, filename);

        return {
          success: true,
          filePath,
          filename,
          directory: dir,
          message: `Downloaded file saved to ${filePath}`,
        };
      },
    },
  ];
}
