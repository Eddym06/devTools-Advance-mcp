/**
 * Browser Console Capture Tools
 *
 * Buffers console.log/warn/error/info/debug calls and uncaught exceptions
 * per tab, using the same persistent CDP client the network interceptors
 * use (see ChromeConnector.getPersistentClient). Capture starts lazily on
 * first read so tools never attach listeners the agent didn't ask for.
 */

import { z } from 'zod';
import type { ChromeConnector } from '../chrome-connector.js';

interface ConsoleEntry {
  type: string; // log, warn, error, info, debug, exception
  text: string;
  timestamp: number;
  url?: string;
  line?: number;
}

const MAX_ENTRIES = 500;
const MAX_TEXT_LENGTH = 2000;

// Keyed by tabId (or 'default'), mirrors ChromeConnector's persistent-client keying.
const buffers = new Map<string, ConsoleEntry[]>();
const attached = new Set<string>();

function truncate(text: string): string {
  return text.length > MAX_TEXT_LENGTH
    ? `${text.slice(0, MAX_TEXT_LENGTH)}… [truncated, ${text.length} chars total]`
    : text;
}

function push(key: string, entry: ConsoleEntry): void {
  let buf = buffers.get(key);
  if (!buf) {
    buf = [];
    buffers.set(key, buf);
  }
  buf.push(entry);
  if (buf.length > MAX_ENTRIES) buf.shift();
}

function formatArg(arg: any): string {
  if (!arg) return 'undefined';
  if (arg.type === 'string') return arg.value ?? '';
  if (arg.value !== undefined) {
    return typeof arg.value === 'object' ? JSON.stringify(arg.value) : String(arg.value);
  }
  if (arg.description) return arg.description;
  return `[${arg.type}]`;
}

async function ensureCapture(connector: ChromeConnector, tabId?: string): Promise<string> {
  const key = tabId || 'default';
  if (attached.has(key)) return key;

  const client = await connector.getPersistentClient(tabId);
  const { Runtime } = client;
  await Runtime.enable();

  Runtime.consoleAPICalled((params: any) => {
    const text = (params.args || []).map(formatArg).join(' ');
    const frame = params.stackTrace?.callFrames?.[0];
    push(key, {
      type: params.type,
      text: truncate(text),
      timestamp: Date.now(),
      url: frame?.url,
      line: frame?.lineNumber,
    });
  });

  Runtime.exceptionThrown((params: any) => {
    const details = params.exceptionDetails;
    push(key, {
      type: 'exception',
      text: truncate(details.exception?.description || details.text || 'Uncaught exception'),
      timestamp: Date.now(),
      url: details.url,
      line: details.lineNumber,
    });
  });

  attached.add(key);
  return key;
}

export function createConsoleTools(connector: ChromeConnector) {
  return [
    {
      name: 'get_console_logs',
      description:
        'Read the browser console (console.log/warn/error/info/debug and uncaught exceptions) for a tab. ' +
        'Capture starts automatically on first call and keeps buffering in the background (last 500 entries) — ' +
        'call again anytime to read new output, e.g. right after clicking a button or running a script.',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional, defaults to current/first tab)'),
        level: z
          .enum(['all', 'log', 'info', 'warn', 'error', 'debug', 'exception'])
          .default('all')
          .describe('Filter by message type'),
        limit: z.number().default(100).describe('Max number of most recent entries to return'),
        clear: z.boolean().default(false).describe('Clear the buffer after reading (isolates logs from the next action)'),
      }),
      handler: async ({ tabId, level = 'all', limit = 100, clear = false }: any) => {
        await connector.verifyConnection();
        const key = await ensureCapture(connector, tabId);

        const buf = buffers.get(key) || [];
        const filtered = level === 'all' ? buf : buf.filter((e) => e.type === level);
        const logs = filtered.slice(-limit).map((e) => ({
          type: e.type,
          text: e.text,
          url: e.url,
          line: e.line,
          time: new Date(e.timestamp).toISOString(),
        }));

        if (clear) buffers.set(key, []);

        return {
          success: true,
          capturing: true,
          totalBuffered: buf.length,
          returned: logs.length,
          logs,
        };
      },
    },
    {
      name: 'clear_console_logs',
      description: 'Clear the buffered console log entries for a tab without reading them.',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)'),
      }),
      handler: async ({ tabId }: any) => {
        const key = tabId || 'default';
        buffers.set(key, []);
        return { success: true, message: `Console log buffer cleared for tab ${key}` };
      },
    },
  ];
}
