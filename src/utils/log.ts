/**
 * Protocol-level logging + request-progress helpers.
 *
 * Standardized MCP features (2025 spec):
 *   - logging: server → client `logging/message` notifications. The server
 *     installs a sink (McpServer.sendLoggingMessage); verbose diagnostics stay
 *     on stderr unless MCP_LOG_LEVEL is raised.
 *   - progress: server → client `notifications/progress` tied to a tool call's
 *     `_meta.progressToken`. Long-running code (Chrome launch, smart
 *     workflows) calls reportProgress() and the client sees live progress
 *     instead of a silent wait.
 *
 * Concurrency note: MCP servers typically process tool calls serially, so a
 * single "active progress" slot is sufficient; if a client pipelines calls,
 * only the last active call receives progress (results are unaffected).
 */

export type ProtocolLogLevel = 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical' | 'alert' | 'emergency';

const RANK: Record<ProtocolLogLevel, number> = {
  debug: 10,
  info: 20,
  notice: 30,
  warning: 40,
  error: 50,
  critical: 60,
  alert: 70,
  emergency: 80,
};

function envLevel(): number {
  const raw = process.env.MCP_LOG_LEVEL as ProtocolLogLevel | undefined;
  const rank = raw ? RANK[raw] : undefined;
  return rank ?? RANK.info;
}

/** Params of a `logging/message` notification (kept local to avoid SDK type churn). */
export interface ProtocolLogParams {
  level: ProtocolLogLevel;
  logger?: string;
  data: unknown;
}

type LogSink = (params: ProtocolLogParams) => void;
let sink: LogSink | null = null;

/** Install the MCP logging sink (called once by server.ts with sendLoggingMessage). */
export function setLogSink(fn: LogSink): void {
  sink = fn;
}

/**
 * Send a protocol logging notification (and mirror warnings/errors to stderr
 * so they survive when no MCP client is attached).
 */
export function protocolLog(level: ProtocolLogLevel, logger: string, data: unknown): void {
  if (RANK[level] < envLevel()) return;
  const params: ProtocolLogParams = { level, logger, data };
  if (sink) {
    try {
      sink(params);
      return;
    } catch {
      /* fall through to stderr */
    }
  }
  if (RANK[level] >= RANK.warning) {
    console.error(`[mcp:${level}] ${logger}:`, data);
  }
}

type ProgressReporter = (progress: number, total: number | undefined, message?: string) => Promise<void> | void;

let activeToken: string | number | null = null;
let activeReporter: ProgressReporter | null = null;

/** The progress token of the tool call currently being executed (if any). */
export function getActiveProgressToken(): string | number | null {
  return activeToken;
}

/** Activate progress reporting for the current tool call (called by server.ts). */
export function setActiveProgress(token: string | number | undefined, reporter: ProgressReporter | null): void {
  activeToken = token ?? null;
  activeReporter = token === undefined ? null : reporter;
}

/** Deactivate progress reporting after the tool call finishes. */
export function clearActiveProgress(): void {
  activeToken = null;
  activeReporter = null;
}

/**
 * Report progress from anywhere inside a long-running tool handler.
 * No-op when the caller did not provide a `_meta.progressToken`.
 */
export async function reportProgress(progress: number, total?: number, message?: string): Promise<void> {
  if (activeToken === null || !activeReporter) return;
  try {
    await activeReporter(progress, total, message);
  } catch {
    /* progress is best-effort */
  }
}
