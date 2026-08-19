import { describe, it, expect } from 'vitest';
import {
  isValidUrl,
  extractDomain,
  formatBytes,
  generateMousePath,
  withTimeout,
  waitFor,
} from '../utils/helpers.js';

describe('isValidUrl', () => {
  it('accepts well-formed URLs', () => {
    expect(isValidUrl('https://example.com')).toBe(true);
    expect(isValidUrl('http://localhost:9222')).toBe(true);
  });

  it('rejects garbage input', () => {
    expect(isValidUrl('not a url')).toBe(false);
    expect(isValidUrl('')).toBe(false);
  });
});

describe('extractDomain', () => {
  it('extracts the hostname', () => {
    expect(extractDomain('https://sub.example.com/path?q=1')).toBe('sub.example.com');
  });

  it('returns empty string for invalid URLs', () => {
    expect(extractDomain('not a url')).toBe('');
  });
});

describe('formatBytes', () => {
  it('formats byte counts across units', () => {
    expect(formatBytes(0)).toBe('0 Bytes');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });
});

describe('generateMousePath', () => {
  it('produces steps+1 points starting near from and ending near to', () => {
    // The path deliberately adds up to +/-1px of random jitter per point,
    // so assert against that tolerance rather than an exact value.
    const path = generateMousePath({ x: 0, y: 0 }, { x: 100, y: 0 }, 10);
    expect(path).toHaveLength(11);
    expect(Math.abs(path[0].x)).toBeLessThanOrEqual(1);
    expect(Math.abs(path[path.length - 1].x - 100)).toBeLessThanOrEqual(1);
  });
});

describe('withTimeout', () => {
  it('resolves when the promise wins the race', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok');
  });

  it('rejects with the given message when the timeout wins', async () => {
    const neverResolves = new Promise(() => {});
    await expect(withTimeout(neverResolves, 20, 'too slow')).rejects.toThrow('too slow');
  });
});

describe('waitFor', () => {
  it('returns true as soon as the condition passes', async () => {
    let calls = 0;
    const result = await waitFor(() => ++calls >= 3, 1000, 5);
    expect(result).toBe(true);
    expect(calls).toBe(3);
  });

  it('returns false once the timeout elapses', async () => {
    const result = await waitFor(() => false, 30, 10);
    expect(result).toBe(false);
  });
});
