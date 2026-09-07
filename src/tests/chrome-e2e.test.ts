import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import net from 'net';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * Real-Chrome end-to-end smoke test.
 *
 * CI does not have a headed/installed Chrome available, so this suite is
 * OPT-IN: run it with `CHROME_MCP_E2E=1 npm test` on a machine that has
 * Google Chrome (or set CHROME_MCP_E2E_CHROME to a custom path). It proves
 * what the unit/integration suites cannot: that the server can actually
 * attach to Chrome over CDP (incl. the origin allow-list), list tabs, read
 * HTML and enforce the URL allow-list.
 */

const e2eEnabled = process.env.CHROME_MCP_E2E === '1';
const chromePath =
  process.env.CHROME_MCP_E2E_CHROME ||
  (process.platform === 'win32'
    ? [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      ].find((p) => fs.existsSync(p))
    : process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : '/usr/bin/google-chrome');

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const p = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(p));
    });
    srv.on('error', reject);
  });
}

async function waitForCdp(port: number): Promise<void> {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('CDP endpoint never became reachable');
}

function firstText(content: unknown): string {
  const parts = content as Array<{ type: string; text?: string }>;
  return parts?.[0]?.text ?? '';
}

async function killTree(proc: ChildProcess | null): Promise<void> {
  if (!proc?.pid) return;
  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (!settled) { settled = true; resolve(); }
    };
    proc.once('exit', done);
    if (process.platform === 'win32') {
      try {
        spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }).once('exit', done);
      } catch {
        proc.kill('SIGKILL');
      }
    } else {
      proc.kill('SIGKILL');
    }
    setTimeout(done, 3000);
  });
}

const run = e2eEnabled && !!chromePath;

describe.skipIf(!run)('real-Chrome E2E smoke', () => {
  let chrome: ChildProcess | null = null;
  let profileDir: string | null = null;
  let port = 0;
  let client: Client | null = null;

  beforeAll(async () => {
    port = await freePort();
    profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-e2e-profile-'));
    chrome = spawn(
      chromePath!,
      [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profileDir}`,
        '--remote-allow-origins=http://localhost,http://127.0.0.1,devtools://devtools',
        '--headless=new',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-gpu',
        'about:blank',
      ],
      { stdio: 'ignore', windowsHide: true }
    );
    await waitForCdp(port);

    const serverEntry = fileURLToPath(new URL('../../dist/index.js', import.meta.url));
    client = new Client({ name: 'e2e-smoke', version: '0.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverEntry, `--port=${port}`],
    });
    await client.connect(transport);
  }, 60_000);

  afterAll(async () => {
    if (client) {
      await client.close().catch(() => {});
    }
    await killTree(chrome);
    chrome = null;
    if (profileDir) {
      // Chrome may still be releasing profile files — retry, never fail the suite.
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          fs.rmSync(profileDir, { recursive: true, force: true });
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 300));
        }
      }
    }
  }, 15_000);

  it('lists the core tools over the real MCP protocol', async () => {
    const { tools } = await client!.listTools();
    expect(tools.map((t) => t.name)).toContain('get_html');
    expect(tools.map((t) => t.name)).not.toContain('start_har_recording'); // hidden tier
  });

  it('lazy-connects to Chrome, lists tabs and reads HTML', async () => {
    const tabs = await client!.callTool({ name: 'manage_tabs', arguments: { action: 'list' } });
    const tabPayload = JSON.parse(firstText(tabs.content));
    expect(tabPayload.success).toBe(true);
    expect(tabPayload.count).toBeGreaterThan(0);

    const html = await client!.callTool({ name: 'get_html', arguments: {} });
    const htmlPayload = JSON.parse(firstText(html.content));
    expect(htmlPayload.success).toBe(true);
  });

  it('blocks file:// navigation (URL allow-list)', async () => {
    const blocked = await client!.callTool({
      name: 'browser_action',
      arguments: { action: 'navigate', url: 'file:///C:/Windows/win.ini' },
    });
    expect(blocked.isError).toBe(true);
  });
});
