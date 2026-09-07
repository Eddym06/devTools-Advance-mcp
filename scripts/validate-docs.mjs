#!/usr/bin/env node
/**
 * Docs ↔ code drift checker.
 *
 * Every guide in this repo must only reference tools that actually exist.
 * The tool set has changed names across releases (navigate→browser_action,
 * click/type→perform_interaction, list_tabs→manage_tabs,
 * enable_network_interception→start_capturing_network_requests,
 * get_har_entries→export_har_file, …) and stale docs actively mislead the
 * LLM clients that read them.
 *
 * How it works:
 *   1. Extract the real tool names from src/tools/*.ts and src/server.ts
 *      (regex on `name: '…'` declarations).
 *   2. Scan README.md and every markdown file under docs/ for backticked
 *      snake_case identifiers (all 90 tools contain an underscore, so this
 *      is a precise detector).
 *   3. Fail (exit 1) on any referenced name that is not a real tool.
 *
 * Usage: node scripts/validate-docs.mjs        (npm run docs:check)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Identifiers that look like tool names but are not tools (allowed in docs).
const ALLOWLIST = new Set([
  'file_path', // schemas/param naming shown as examples
  'output_dir',
  'download_dir',
  'request_id',
  'session_name',
  'session_data',
  'headers_list',
]);

function findToolNames() {
  const names = new Set();
  const files = [];
  const toolsDir = path.join(root, 'src', 'tools');
  for (const entry of fs.readdirSync(toolsDir)) {
    if (entry.endsWith('.ts')) files.push(path.join(toolsDir, entry));
  }
  files.push(path.join(root, 'src', 'server.ts')); // show/hide_advanced_tools
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const isServer = path.basename(file) === 'server.ts';
    // src/tools/*:  name: 'tool_name'
    // src/server.ts: server.registerTool('tool_name', …)  (show/hide control tools)
    const pattern = isServer
      ? /registerTool\(\s*'([a-z][a-z0-9_]+)'/g
      : /name:\s*'([a-z][a-z0-9_]+)'/g;
    for (const m of source.matchAll(pattern)) {
      names.add(m[1]);
    }
  }
  return names;
}

function* walkMarkdown(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkMarkdown(full);
    } else if (entry.name.endsWith('.md')) {
      yield full;
    }
  }
}

function referencedNames(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  // name -> { line: number, text: string }
  const refs = new Map();
  // snake_case inside backticks: every real tool name matches this shape.
  const re = /`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g;
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(re)) {
      if (!refs.has(m[1])) refs.set(m[1], { line: i + 1, text: lines[i] });
    }
  }
  return refs;
}

const tools = findToolNames();

// CHANGELOG.md is historical by nature (it documents the tools that existed
// in each past release) — only the "current-state" guides are enforced.
const docFiles = [
  path.join(root, 'README.md'),
  ...walkMarkdown(path.join(root, 'docs')).filter((f) => path.basename(f) !== 'CHANGELOG.md'),
];

let problems = 0;
let references = 0;
const checked = [];

function lineTextHasRealTool(text, toolsSet) {
  const re = /`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g;
  for (const m of text.matchAll(re)) {
    if (toolsSet.has(m[1])) return true;
  }
  return false;
}

for (const file of docFiles) {
  for (const [name, info] of referencedNames(file)) {
    references++;
    if (tools.has(name) || ALLOWLIST.has(name)) continue;
    // Legacy tools are only acceptable on a line that maps them to a real
    // tool (the "❌ old habit → ✅ current tool" migration tables).
    if (lineTextHasRealTool(info.text, tools)) continue;
    problems++;
    const rel = path.relative(root, file);
    console.error(`✗ ${rel}:${info.line} references unknown tool: \`${name}\``);
  }
  checked.push(path.relative(root, file));
}

console.log(`Tools found in source: ${tools.size}`);
console.log(`Docs scanned: ${checked.length} file(s), ${references} tool reference(s).`);
if (problems > 0) {
  console.error(`\n✗ Docs drift detected: ${problems} reference(s) to non-existent tools.`);
  console.error('Fix the guides (rename to the current consolidated tools) or add a justified exception.');
  process.exit(1);
}
console.log('✓ Docs ↔ code check passed — every referenced tool exists.');
