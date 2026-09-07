import { describe, it, expect } from 'vitest';
import { createHarLog, headerValueFromList, timingsFromCdpTiming } from '../utils/har.js';

describe('createHarLog (HAR 1.2 shape)', () => {
  it('produces a HAR 1.2 log with the real creator version', () => {
    const { log } = createHarLog([], []);
    expect(log.version).toBe('1.2');
    expect(log.creator.name).toBe('Custom Chrome MCP');
    expect(log.creator.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(log.pages).toEqual([]);
    expect(log.entries).toEqual([]);
  });

  it('normalizes partial entries with guaranteed required fields', () => {
    const { log } = createHarLog([], [
      { requestId: 'r1', request: { method: 'POST', url: 'https://example.com/x', postData: '{}' }, time: -5 },
    ]);
    const entry = log.entries[0];
    expect(entry.time).toBe(0); // clamped ≥ 0
    expect(entry.request.queryString).toEqual([]);
    expect(entry.request.cookies).toEqual([]);
    expect(entry.response.content.mimeType).toBe('');
    expect(entry.timings).toMatchObject({ blocked: -1, send: 0, wait: 0 });
    // extras survive normalization
    expect(entry.requestId).toBe('r1');
  });

  it('drops non-object entries', () => {
    const { log } = createHarLog([], [null, undefined, 'x', 1]);
    expect(log.entries).toEqual([]);
  });
});

describe('headerValueFromList', () => {
  it('matches case-insensitively', () => {
    const headers = [
      { name: 'Location', value: 'https://a/next' },
      { name: 'content-type', value: 'text/html' },
    ];
    expect(headerValueFromList(headers, 'location')).toBe('https://a/next');
    expect(headerValueFromList(headers, 'Content-Type')).toBe('text/html');
    expect(headerValueFromList(headers, 'x-missing')).toBeUndefined();
    expect(headerValueFromList(undefined, 'location')).toBeUndefined();
  });
});

describe('timingsFromCdpTiming', () => {
  it('maps CDP ResourceTiming seconds to HAR milliseconds', () => {
    const timings = timingsFromCdpTiming({
      requestTime: 0,
      dnsStart: 0.1,
      dnsEnd: 0.15,
      connectStart: 0.15,
      connectEnd: 0.21,
      sslStart: 0.16,
      sslEnd: 0.18,
      sendStart: 0.21,
      sendEnd: 0.25,
      receiveHeadersEnd: 0.7,
    });
    expect(timings.dns).toBe(50);
    expect(timings.connect).toBe(60);
    expect(timings.ssl).toBe(20);
    expect(timings.send).toBe(40);
    expect(timings.wait).toBe(450);
    expect(timings.blocked).toBe(-1);
  });

  it('leaves unmeasured phases as -1 / defaults', () => {
    const timings = timingsFromCdpTiming({ sendStart: 0.1, sendEnd: 0.2, receiveHeadersEnd: 0.5 });
    expect(timings.dns).toBe(-1);
    expect(timings.connect).toBe(-1);
    expect(timings.ssl).toBe(-1);
    expect(timings.send).toBe(100);
    expect(timings.wait).toBe(300);
    expect(timingsFromCdpTiming(undefined)).toMatchObject({ blocked: -1, send: 0, wait: 0 });
  });
});
