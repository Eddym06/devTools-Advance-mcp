/**
 * Temp File Storage Utilities
 * Saves large binary payloads (screenshots, PDFs) to disk instead of
 * returning them inline as base64, which can exceed MCP message size limits.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const STORAGE_SUBDIR = 'custom-chrome-mcp-screenshots';

function getStorageDir(): string {
  const dir = path.join(os.tmpdir(), STORAGE_SUBDIR);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Decode a base64 string and write it to a uniquely named file in the
 * system temp directory. Returns the absolute path to the written file.
 */
export function saveBase64ToFile(
  base64Data: string,
  extension: string,
  prefix: string,
  tabId?: string
): string {
  const dir = getStorageDir();
  const tabPart = tabId ? `${tabId}-` : '';
  const fileName = `${prefix}-${tabPart}${Date.now()}.${extension}`;
  const filePath = path.join(dir, fileName);

  fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));

  return filePath;
}
