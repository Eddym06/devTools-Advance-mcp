#!/usr/bin/env node

/**
 * Chrome DevTools Advanced MCP Server
 * Main entry point. Server assembly lives in server.ts (kept separate so it
 * can be integration-tested via InMemoryTransport); this file only handles
 * CLI args, process lifecycle, and the stdio transport.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { ChromeConnector } from './chrome-connector.js';
import { createServer } from './server.js';
// Module-level capture/interception state must be reset whenever the browser
// session ends, or a relaunch inherits stale buffers/listeners from the dead
// Chrome.
import { resetConsoleState } from './tools/console.js';
import { resetNetworkAccessibilityState } from './tools/network-accessibility.js';
import { resetAdvancedNetworkState } from './tools/advanced-network.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')) as {
  name: string;
  version: string;
};

// Parse command line arguments. Port is only pinned when the user passes
// --port=NNNN; otherwise ChromeConnector uses its default (9222).
const args = process.argv.slice(2);
const portArg = args.find((arg) => arg.startsWith('--port='));
const configuredPort = portArg ? parseInt(portArg.split('=')[1], 10) : undefined;

// Initialize Chrome connector
const connector = new ChromeConnector(configuredPort);

// Reset cross-module browser state whenever the session is torn down.
connector.onDisconnect(() => {
  resetConsoleState();
  resetNetworkAccessibilityState();
  resetAdvancedNetworkState();
});

const server = createServer(connector, pkg);

// Start server
async function main() {
  console.error(`[MCP] ${pkg.name} v${pkg.version} starting...`);
  console.error(`[MCP] CDP Port: ${connector.getPort()}`);

  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } catch (error) {
    const err = error as Error;
    console.error('[MCP] Failed to start server:', err.message);
    process.exit(1);
  }
}

let shuttingDown = false;

/**
 * Graceful shutdown: kills a Chrome instance that THIS server launched (so
 * orphan browsers with open debug ports do not pile up between restarts) and
 * releases every CDP/Playwright resource. A second signal forces exit.
 */
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    console.error(`\n[MCP] Forced exit (second ${signal})`);
    process.exit(1);
  }
  shuttingDown = true;
  console.error(`\n[MCP] Shutting down server (${signal})...`);
  try {
    await connector.shutdown();
  } catch (err) {
    console.error('[MCP] Error during shutdown:', (err as Error).message);
  }
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

// Run server
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
