import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { assertSafeWebUrl, getPackageVersion } from '../utils/helpers.js';
import { resolveOutputDir, resolveOutputPath, sanitizeFilename } from '../utils/file-storage.js';

describe('assertSafeWebUrl', () => {
  it('accepts http(s) URLs and normalizes them', () => {
    expect(assertSafeWebUrl('https://example.com/path?q=1')).toBe('https://example.com/path?q=1');
    expect(assertSafeWebUrl('http://localhost:3000/x')).toBe('http://localhost:3000/x');
  });

  it('allows the internal chrome pages the server itself uses', () => {
    expect(assertSafeWebUrl('about:blank')).toBe('about:blank');
    expect(assertSafeWebUrl('chrome://newtab/')).toBe('chrome://newtab/');
  });

  it('rejects file:// by default (local-file read primitive)', () => {
    expect(() => assertSafeWebUrl('file:///C:/Windows/win.ini')).toThrow(/Blocked|http\(s\)/);
  });

  it('rejects other non-web schemes', () => {
    expect(() => assertSafeWebUrl('javascript:alert(1)')).toThrow();
    expect(() => assertSafeWebUrl('data:text/html,<script>1</script>')).toThrow();
    expect(() => assertSafeWebUrl('not a url')).toThrow(/Invalid/);
  });
});

describe('sanitizeFilename / output sandbox', () => {
  it('strips path components and illegal characters', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('a<b>:c|d?.har', 'out')).toBe('a_b__c_d_.har');
    expect(sanitizeFilename('', 'fallback')).toBe('fallback');
  });

  it('defaults output dir to the temp subfolder', () => {
    const dir = resolveOutputDir(undefined, 'chrome-mcp-test');
    expect(dir).toBe(path.join(os.tmpdir(), 'chrome-mcp-test'));
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('allows dirs inside cwd or temp, refuses anything else', () => {
    const cwdDir = resolveOutputDir(process.cwd(), 'x'); // inside cwd → allowed
    expect(fs.existsSync(cwdDir)).toBe(true);
    expect(() => resolveOutputDir('C:\\Windows\\System32', 'x')).toThrow(/Refusing to write outside/);
  });

  it('combines dir confinement with filename sanitation', () => {
    const { dir, filePath } = resolveOutputPath(undefined, '../evil.har', 'chrome-mcp-test');
    expect(filePath).toBe(path.join(dir, 'evil.har'));
    expect(dir).toBe(path.join(os.tmpdir(), 'chrome-mcp-test'));
  });
});

describe('getPackageVersion', () => {
  it('returns the real package version (1.4.x at time of writing)', () => {
    const version = getPackageVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
