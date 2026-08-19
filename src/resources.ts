/**
 * MCP Resources
 *
 * Exposes live browser state as resources (cacheable/listable by the
 * client) instead of only as one-shot tool call results:
 *   chrome://tab/{tabId}/html        — current full-page outerHTML
 *   chrome://tab/{tabId}/screenshot  — current viewport PNG screenshot
 *   chrome://tab/{tabId}/har         — current HAR recording buffer
 *
 * These are deliberately simpler than the equivalent tools (get_html,
 * screenshot, start_har_recording/...): no selector/clip/format options —
 * a resource represents "the current state at this URI", parameterized
 * reads stay tool territory.
 */

import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ChromeConnector } from './chrome-connector.js';
import { truncateOutput } from './utils/truncate.js';
import { getHarSnapshot } from './tools/advanced-network.js';

type ResourceKind = 'html' | 'screenshot' | 'har';

const MIME_TYPES: Record<ResourceKind, string> = {
  html: 'text/html',
  screenshot: 'image/png',
  har: 'application/json',
};

async function listTabResources(connector: ChromeConnector, kind: ResourceKind) {
  try {
    await connector.verifyConnection();
  } catch {
    // No browser attached yet — nothing to list, not an error.
    return { resources: [] };
  }

  const tabs = await connector.listTabs();
  return {
    resources: tabs
      .filter((t) => t.type === 'page')
      .map((t) => ({
        uri: `chrome://tab/${t.id}/${kind}`,
        name: `${kind}: ${t.title || t.url || t.id}`,
        mimeType: MIME_TYPES[kind],
      })),
  };
}

function tabIdFromVariables(variables: Record<string, unknown>): string {
  const value = variables.tabId;
  return Array.isArray(value) ? String(value[0]) : String(value);
}

export function registerResources(server: McpServer, connector: ChromeConnector): void {
  server.registerResource(
    'tab-html',
    new ResourceTemplate('chrome://tab/{tabId}/html', {
      list: () => listTabResources(connector, 'html'),
    }),
    {
      title: 'Tab HTML',
      description: 'Current full-page outerHTML for an open tab (find tabId via manage_tabs).',
      mimeType: 'text/html',
    },
    async (uri, variables) => {
      const tabId = tabIdFromVariables(variables);
      await connector.verifyConnection();
      const client = await connector.getTabClient(tabId);
      const { Runtime } = client;
      await Runtime.enable();

      const result: any = await Runtime.evaluate({
        expression: 'document.documentElement.outerHTML',
        returnByValue: true,
      });
      if (result.exceptionDetails) {
        throw new Error(`Failed to read HTML: ${result.exceptionDetails.exception?.description || 'unknown error'}`);
      }

      const truncated = truncateOutput(result.result.value || '', 200000, 'html');
      return {
        contents: [{ uri: uri.href, mimeType: 'text/html', text: truncated.data }],
      };
    }
  );

  server.registerResource(
    'tab-screenshot',
    new ResourceTemplate('chrome://tab/{tabId}/screenshot', {
      list: () => listTabResources(connector, 'screenshot'),
    }),
    {
      title: 'Tab Screenshot',
      description: 'Current viewport screenshot (PNG) for an open tab (find tabId via manage_tabs).',
      mimeType: 'image/png',
    },
    async (uri, variables) => {
      const tabId = tabIdFromVariables(variables);
      await connector.verifyConnection();
      const client = await connector.getTabClient(tabId);
      const { Page } = client;
      await Page.enable();

      const { data } = await Page.captureScreenshot({ format: 'png' });
      return {
        contents: [{ uri: uri.href, mimeType: 'image/png', blob: data }],
      };
    }
  );

  server.registerResource(
    'tab-har',
    new ResourceTemplate('chrome://tab/{tabId}/har', {
      list: () => listTabResources(connector, 'har'),
    }),
    {
      title: 'Tab HAR Recording',
      description:
        'Current HAR recording buffer for an open tab. Call start_har_recording first — reading this resource ' +
        'does not consume/stop the recording (unlike the stop_har_recording tool).',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const tabId = tabIdFromVariables(variables);
      const har = getHarSnapshot(tabId);
      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(har, null, 2) }],
      };
    }
  );
}
