/**
 * Temp File Storage Utilities
 * Saves large binary payloads (screenshots, PDFs) to disk instead of
 * returning them inline as base64, which can exceed MCP message size limits.
 * Also provides sandboxed output resolution for model-controlled filenames
 * (HAR exports, downloads) so tools can never write outside the working
 * directory or the system temp folder.
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
  const tabPart = tabId ? `${sanitizeFilename(tabId)}-` : '';
  const fileName = `${prefix}-${tabPart}${Date.now()}.${extension}`;
  const filePath = path.join(dir, fileName);

  fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));

  return filePath;
}

/**
 * Replaces characters that are illegal in filenames / dangerous in paths.
 */
export function sanitizeFilename(name: string, fallback = 'output'): string {
  const cleaned = path
    .basename(name)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/^\.+/, '') // no dotfiles / traversal attempts
    .trim();
  return cleaned || fallback;
}

/**
 * Resolve and confine an output directory.
 *
 * Model-controlled paths (HAR exports, download folders) must not be able to
 * write anywhere on disk. This accepts:
 *   - no dir  → <tmp>/<defaultSubdir> (sandboxed default)
 *   - a dir inside the server's working directory
 *   - a dir inside the system temp folder
 * Anything else is refused. The directory is created if missing.
 */
export function resolveOutputDir(requestedDir: string | undefined, defaultSubdir: string): string {
  let dir: string;
  if (!requestedDir) {
    dir = path.join(os.tmpdir(), defaultSubdir);
  } else {
    const resolved = path.resolve(requestedDir);
    const cwd = path.resolve(process.cwd());
    const tmpRoot = path.resolve(os.tmpdir());
    const insideCwd = resolved === cwd || resolved.startsWith(cwd + path.sep);
    const insideTmp = resolved === tmpRoot || resolved.startsWith(tmpRoot + path.sep);
    if (!insideCwd && !insideTmp) {
      throw new Error(
        `Refusing to write outside the working directory or temp folder: "${requestedDir}". ` +
        `Use a path inside ${cwd} or ${tmpRoot}.`
      );
    }
    dir = resolved;
  }
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Resolve a full, sandboxed file path for a model-controlled filename.
 * Combines resolveOutputDir + sanitizeFilename.
 */
export function resolveOutputPath(
  requestedDir: string | undefined,
  filename: string,
  defaultSubdir: string
): { dir: string; filePath: string } {
  const dir = resolveOutputDir(requestedDir, defaultSubdir);
  const safeName = sanitizeFilename(filename);
  return { dir, filePath: path.join(dir, safeName) };
}
