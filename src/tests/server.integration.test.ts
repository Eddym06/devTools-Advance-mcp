import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import type { ChromeConnector } from '../chrome-connector.js';
import { createServer } from '../server.js';

// End-to-end over the real MCP protocol (in-memory transport, no stdio/process
// involved) so this actually exercises what a client sees: tool visibility,
// the advanced-tools show/hide flow, and annotation shape — not just that
// the TypeScript compiles.
describe('MCP server integration', () => {
  let client: Client;

  beforeAll(async () => {
    const fakeConnector = {} as ChromeConnector;
    const server = createServer(fakeConnector, { name: 'test-server', version: '0.0.0-test' });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.0-test' });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterAll(async () => {
    await client.close();
  });

  it('hides advanced tools by default and exposes the show/hide control tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);

    expect(names).toContain('show_advanced_tools');
    expect(names).toContain('hide_advanced_tools');
    expect(names).toContain('get_html'); // core
    expect(names).not.toContain('start_har_recording'); // advanced, hidden by default
  });

  it('reveals advanced tools after show_advanced_tools, and hides them again after hide_advanced_tools', async () => {
    await client.callTool({ name: 'show_advanced_tools', arguments: {} });
    const afterShow = await client.listTools();
    expect(afterShow.tools.map((t) => t.name)).toContain('start_har_recording');

    await client.callTool({ name: 'hide_advanced_tools', arguments: {} });
    const afterHide = await client.listTools();
    expect(afterHide.tools.map((t) => t.name)).not.toContain('start_har_recording');
  });

  it('marks read-only tools and destructive tools with the expected annotation hints', async () => {
    const { tools } = await client.listTools();

    const getHtml = tools.find((t) => t.name === 'get_html');
    expect(getHtml?.annotations?.readOnlyHint).toBe(true);
    expect(getHtml?.annotations?.destructiveHint).toBeFalsy();

    const closeBrowser = tools.find((t) => t.name === 'close_browser');
    expect(closeBrowser?.annotations?.destructiveHint).toBe(true);
  });

  it('gives every tool a human-readable title distinct from its programmatic name', async () => {
    const { tools } = await client.listTools();
    const getHtml = tools.find((t) => t.name === 'get_html');
    expect(getHtml?.title).toBe('Get HTML');
  });

  it('declares an outputSchema for the tools that opted in (get_html, screenshot, manage_tabs)', async () => {
    const { tools } = await client.listTools();
    for (const name of ['get_html', 'screenshot', 'manage_tabs']) {
      const tool = tools.find((t) => t.name === name);
      expect(tool?.outputSchema, `${name} should declare an outputSchema`).toBeDefined();
      expect(tool?.outputSchema?.properties).toHaveProperty('success');
    }
    // Spot check a tool that deliberately did NOT get one, to make sure this
    // isn't just always-on behavior from the SDK.
    const browserAction = tools.find((t) => t.name === 'browser_action');
    expect(browserAction?.outputSchema).toBeUndefined();
  });

  it('lists no chrome://tab resources when no browser is attached, without throwing', async () => {
    const { resources } = await client.listResources();
    expect(resources).toEqual([]);
  });

  it('lists all three prompts and fills the scrape-table template with its argument', async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(
      ['audit-accessibility', 'debug-console-errors', 'scrape-table'].sort()
    );

    const result = await client.getPrompt({ name: 'scrape-table', arguments: { selector: '.product-card' } });
    const text = (result.messages[0].content as { text: string }).text;
    expect(text).toContain('.product-card');
    expect(text).toContain('get_html');
  });
});
