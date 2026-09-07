/**
 * HAR (HTTP Archive) helpers.
 *
 * Centralizes HAR 1.2 document construction so every producer (start/stop/
 * export tools and the chrome://tab/{tabId}/har resource) emits the same,
 * validated shape: correct creator version from package.json, guaranteed
 * required fields on every entry, and CDP ResourceTiming → HAR timings mapping.
 */

import { getPackageVersion } from './helpers.js';

/** Case-insensitive lookup of a header (headers are name/value pairs). */
export function headerValueFromList(headers: Array<{ name: string; value: string }> | undefined, name: string): string | undefined {
  if (!Array.isArray(headers)) return undefined;
  const lower = name.toLowerCase();
  const found = headers.find((h) => h.name.toLowerCase() === lower);
  return found?.value;
}

function defaultTimings(): Record<string, number> {
  return { blocked: -1, dns: -1, connect: -1, send: 0, wait: 0, receive: 0, ssl: -1 };
}

/**
 * Map CDP `Network.responseReceived` `response.timing` (ResourceTiming) into
 * HAR `timings`. All CDP timing fields are seconds relative to requestTime;
 * -1/undefined means "not measured" and maps to -1 (or 0 for send/wait).
 */
export function timingsFromCdpTiming(timing: any): Record<string, number> {
  const t = timing ?? {};
  const ms = (start: number | undefined, end: number | undefined): number => {
    if (typeof start !== 'number' || typeof end !== 'number' || start < 0 || end < 0) return -1;
    return Math.max(0, Math.round((end - start) * 1000));
  };
  const dns = ms(t.dnsStart, t.dnsEnd);
  const connect = ms(t.connectStart, t.connectEnd);
  const ssl = ms(t.sslStart, t.sslEnd);
  const send = ms(t.sendStart, t.sendEnd);
  const wait = ms(t.sendEnd, t.receiveHeadersEnd);

  const timings = defaultTimings();
  if (dns >= 0) timings.dns = dns;
  if (connect >= 0) timings.connect = connect;
  if (ssl >= 0) timings.ssl = ssl;
  timings.send = send >= 0 ? send : 0;
  timings.wait = wait >= 0 ? wait : 0;
  return timings;
}

function normalizeEntry(entry: any): any {
  if (!entry || typeof entry !== 'object') return null;
  const req = entry.request ?? {};
  return {
    ...entry,
    time: typeof entry.time === 'number' ? Math.max(0, entry.time) : -1,
    request: {
      method: req.method ?? 'GET',
      url: req.url ?? '',
      httpVersion: req.httpVersion ?? 'HTTP/1.1',
      headers: Array.isArray(req.headers) ? req.headers : [],
      queryString: Array.isArray(req.queryString) ? req.queryString : [],
      cookies: Array.isArray(req.cookies) ? req.cookies : [],
      headersSize: typeof req.headersSize === 'number' ? req.headersSize : -1,
      bodySize: typeof req.bodySize === 'number' ? req.bodySize : 0,
    },
    response: entry.response ?? { status: 0, statusText: '', httpVersion: '', headers: [], cookies: [], content: { size: 0, mimeType: '' }, redirectURL: '', headersSize: -1, bodySize: -1 },
    cache: entry.cache ?? {},
    timings: entry.timings ? { ...defaultTimings(), ...entry.timings } : defaultTimings(),
  };
}

/** Build a complete HAR 1.2 document from raw pages/entries. */
export function createHarLog(pages: any[], entries: any[]): { log: { version: string; creator: { name: string; version: string }; pages: any[]; entries: any[] } } {
  return {
    log: {
      version: '1.2',
      creator: { name: 'Custom Chrome MCP', version: getPackageVersion() },
      pages: Array.isArray(pages) ? pages : [],
      entries: (Array.isArray(entries) ? entries : []).map(normalizeEntry).filter(Boolean),
    },
  };
}
