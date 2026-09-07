/**
 * Utility functions for Custom Chrome MCP
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Reads the package version from package.json at runtime.
 * Works both from `src/` (dev) and from `dist/` (published tarball, where
 * package.json sits two levels up next to dist/).
 */
export function getPackageVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const WEB_PROTOCOLS = new Set(['http:', 'https:']);
// Internal chrome pages the server itself uses; navigation to anything else
// non-web is refused.
const INTERNAL_PAGES = new Set(['about:blank', 'chrome://newtab/']);

/**
 * Validates a URL before the browser is asked to navigate to it.
 *
 * Why: CDP navigation accepts `file://…`, which combined with get_html /
 * execute_script / the tab-html resource becomes an arbitrary local-file read
 * primitive. A malicious webpage or prompt-injected instruction could steer a
 * naive agent into it. Only http(s) is allowed by default; `file://` can be
 * re-enabled explicitly with CHROME_MCP_ALLOW_FILE_URLS=1 for local testing.
 *
 * @returns the normalized URL string.
 */
export function assertSafeWebUrl(raw: string, label = 'url'): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Invalid ${label}: "${raw}" is not a valid URL`);
  }

  if (WEB_PROTOCOLS.has(parsed.protocol)) return parsed.toString();

  if (parsed.protocol === 'file:' && process.env.CHROME_MCP_ALLOW_FILE_URLS === '1') {
    return parsed.toString();
  }

  if (INTERNAL_PAGES.has(parsed.toString())) return parsed.toString();

  throw new Error(
    `Blocked ${label}: "${raw}" — only http(s) URLs can be navigated to. ` +
    `(file:// requires CHROME_MCP_ALLOW_FILE_URLS=1; other schemes are not supported.)`
  );
}

/**
 * Add random human-like delay
 */
export async function humanDelay(min: number = 100, max: number = 500): Promise<void> {
  const delay = Math.random() * (max - min) + min;
  await new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Execute a promise with a timeout
 */
export async function withTimeout<T>(
  promise: Promise<T>, 
  timeoutMs: number, 
  errorMessage: string = 'Operation ended by timeout'
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout;
  
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`${errorMessage} (${timeoutMs}ms)`));
    }, timeoutMs);
  });
  
  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutHandle!);
    return result;
  } catch (error) {
    clearTimeout(timeoutHandle!);
    throw error;
  }
}

/**
 * Generate random mouse movement path
 */
export function generateMousePath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps: number = 10
): Array<{ x: number; y: number }> {
  const path: Array<{ x: number; y: number }> = [];
  
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Add some randomness to make it more human-like
    const noise = (Math.random() - 0.5) * 2;
    
    path.push({
      x: from.x + (to.x - from.x) * t + noise,
      y: from.y + (to.y - from.y) * t + noise
    });
  }
  
  return path;
}

/**
 * Wait for condition with timeout
 */
export async function waitFor(
  condition: () => Promise<boolean> | boolean,
  timeout: number = 30000,
  interval: number = 100
): Promise<boolean> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    try {
      if (await condition()) {
        return true;
      }
    } catch (error) {
      // Continue waiting
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  
  return false;
}

/**
 * Retry function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (i < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, i);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError!;
}

/**
 * Parse CSS selector to CDP selector
 */
export function parseSelectorToCDP(selector: string): any {
  // Simple CSS to CDP selector conversion
  // This is a basic implementation, can be enhanced
  return {
    type: 'css',
    value: selector
  };
}

/**
 * Format bytes to human readable
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Generate unique ID
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Deep clone object
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Check if URL is valid
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract domain from URL
 */
export function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return '';
  }
}

/**
 * Navigate a CDP page client to `url` and wait for the page's `load` event.
 *
 * CRITICAL: the load-event promise must be created BEFORE Page.navigate is
 * sent — the event is one-shot, so awaiting it *after* navigation hangs
 * forever on fast/local pages (the event already fired). Several handlers in
 * this codebase previously did exactly that; use this helper everywhere a
 * tool navigates. URL is validated via assertSafeWebUrl.
 *
 * @returns the normalized (validated) URL that was navigated to.
 */
export async function navigateAndWaitForLoad(
  client: any,
  url: string,
  timeoutMs: number = 30000,
  waitUntil: 'load' | 'domcontentloaded' = 'load'
): Promise<string> {
  const safeUrl = assertSafeWebUrl(url);
  const { Page, Network } = client;

  await Page.enable();
  // Subscribe to the one-shot event BEFORE triggering navigation.
  const loadPromise = waitUntil === 'domcontentloaded' ? Page.domContentEventFired() : Page.loadEventFired();
  await Network.enable().catch(() => { /* Network is optional for navigation */ });

  const navResponse = await Page.navigate({ url: safeUrl });
  if (navResponse?.errorText) {
    throw new Error(`Navigation failed: ${navResponse.errorText}`);
  }

  await withTimeout(loadPromise, timeoutMs, `Timeout waiting for '${waitUntil}' after navigating to ${safeUrl}`);
  await humanDelay();
  return safeUrl;
}
