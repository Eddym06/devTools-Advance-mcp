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

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')) as {
  name: string;
  version: string;
};

// Parse command line arguments
const args = process.argv.slice(2);
const portArg = args.find((arg) => arg.startsWith('--port='));
const PORT = portArg ? parseInt(portArg.split('=')[1], 10) : 9222;

// Initialize Chrome connector
const connector = new ChromeConnector(PORT);

const server = createServer(connector, pkg);

// Start server
async function main() {
  console.error(`[MCP] ${pkg.name} v${pkg.version} starting...`);
  console.error(`[MCP] CDP Port: ${PORT}`);

  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } catch (error) {
    const err = error as Error;
    console.error('[MCP] Failed to start server:', err.message);
    process.exit(1);
  }
}

// Handle shutdown gracefully
process.on('SIGINT', async () => {
  console.error('\n[MCP] Shutting down server...');
  await connector.disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.error('\n[MCP] Shutting down server...');
  await connector.disconnect();
  process.exit(0);
});

// Run server
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
