# Changelog

All notable changes to this project will be documented in this file.

## [1.4.0] - 2026-08-19

### ✨ MCP Resources

- `chrome://tab/{tabId}/html`, `chrome://tab/{tabId}/screenshot`, `chrome://tab/{tabId}/har` — current tab state exposed as listable/cacheable resources instead of only one-shot tool results (`src/resources.ts`).

### ✨ MCP Prompts

- `audit-accessibility`, `debug-console-errors`, `scrape-table` — pre-baked task templates that instruct the calling LLM to chain this server's own tools (`src/prompts.ts`).

### ✨ Explicit output schemas

- `get_html`, `screenshot`, and `manage_tabs` now declare a Zod `outputSchema`; the SDK validates every non-error return against it and forwards typed `structuredContent` instead of relying on the generic best-effort passthrough used by the rest of the tools.

### ✨ New tools

- `download_file` — clicks a download trigger, enables `Browser.setDownloadBehavior` for the call, and returns the saved file path.
- `fill_form` — fills multiple fields (text/select/checkbox, auto-detected) in one call instead of N `perform_interaction` calls.
- `run_performance_audit` — Core Web Vitals (LCP, CLS) and basic timing (TTFB, FCP, long tasks, JS heap) via `PerformanceObserver`.
- `emulate_network_conditions` — throttle to Slow 3G / Fast 3G / 4G / offline (or custom values) via `Network.emulateNetworkConditions`.
- `get_indexed_db` — list IndexedDB databases, or read records from every object store in one.

### 🔒 Isolation fix

- `test_with_different_cookies` previously mutated the *real* tab's live cookies (save → overwrite → navigate → best-effort restore), meaning a crash mid-run could leave the user's actual session in the test's cookie state. It now runs inside a throwaway Playwright `browser.newContext()` — a separate cookie jar/storage that never touches the real profile. The now-meaningless `restoreOriginal` parameter was removed.

### 🧹 Housekeeping

- `.npmignore` was letting `assets/logo.png` (4.5MB) and `recordings/demo_recording.har` (86KB) into every published tarball — neither is needed at runtime (GitHub/npm render README images straight from the repo, not the tarball). Published package size: 4.7MB → 238KB.

## [1.3.0] - 2026-08-19

### 🚀 Modernization

- Migrated the server from the low-level `Server` API to `McpServer.registerTool`, dropping the ~70-line hand-rolled Zod→JSON-Schema converter in favor of the SDK's own conversion.
- Added MCP tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`, `title`) across all tools, derived from naming convention with explicit overrides for composite/lifecycle tools (see `src/tool-annotations.ts`).
- `show_advanced_tools` / `hide_advanced_tools` now use the SDK's native `RegisteredTool.enable()/disable()` (auto-sends `notifications/tools/list_changed`) instead of a manual boolean flag + manual notification call.
- Tool results now include `structuredContent` alongside the text block where the handler returns a plain object.
- Upgraded to Zod v4, `@modelcontextprotocol/sdk` 1.30, Playwright 1.62.
- Replaced hand-rolled `escJS` string-quote escaping (used when interpolating selectors into `Runtime.evaluate` expressions) with `JSON.stringify`, which correctly escapes all cases instead of just backslash/quote.

### 🐛 Fixes

- `get_accessibility_tree` was registered under the same name in both `capture.ts` and `network-accessibility.ts`; the weaker duplicate (capture.ts) is removed.
- `chrome-connector.ts` waited 3s twice in a row during launch verification (a copy-paste duplication), doubling launch latency for no reason.
- Server-reported version now reads from `package.json` at runtime instead of being hardcoded separately (was silently out of sync).

### ✨ New tools

- `get_console_logs` — reads buffered `console.log/warn/error/info/debug` output and uncaught exceptions for a tab; capture starts automatically on first call.
- `clear_console_logs` — clears the buffer without reading it.

### 🧹 Housekeeping

- Removed `src/tools/advanced-network.backup.ts` (1100+ lines of dead code) and the stray `package/` directory (leftover `npm pack` artifacts) from version control.
- Added `eslint.config.js` (flat config) — `npm run lint` was previously broken (ESLint 9 requires flat config, none existed).
- Added `vitest` with a unit suite (`src/tests/helpers.test.ts`), a registry regression test guarding against duplicate tool names (`src/tests/registry.test.ts`), and a full protocol-level integration test using an in-memory MCP client (`src/tests/server.integration.test.ts`).
- Added GitHub Actions CI (`.github/workflows/ci.yml`): lint + build + test on Node 20 and 22.
- Split `index.ts` into `registry.ts` (pure tool aggregation) and `server.ts` (McpServer assembly) so both are unit-testable without booting stdio transport.

## [1.0.0] - 2026-01-07

### ✨ Features

#### Core
- Initial release of Custom Chrome MCP
- Connect to existing Chrome instances via CDP (port 9222)
- Full MCP protocol implementation with 44 tools

#### Navigation & Tabs (8 tools)
- Navigate to URLs with wait conditions
- Browser history (back/forward)
- Page reload with cache options
- Multi-tab management (list, create, close, switch)
- Get current URL and page info

#### Interaction (8 tools)
- Click elements with human-like delays
- Type text with realistic timing
- Get text content and attributes
- Execute custom JavaScript
- Scroll pages and elements
- Wait for selectors with timeout
- Select options from dropdowns

#### Anti-Detection (5 tools)
- Stealth mode with navigator.webdriver masking
- Custom user agent configuration
- Viewport and device emulation
- Geolocation spoofing
- Timezone override

#### Service Workers (9 tools)
- List all registered service workers
- Get detailed worker information
- Unregister service workers
- Force update registrations
- Start/stop workers
- Inspect workers in DevTools
- Skip waiting phase
- Manage service worker caches

#### Capture & Export (5 tools)
- Screenshots (PNG/JPEG, full page, custom areas)
- Export to PDF
- Get HTML content
- Page layout metrics
- Accessibility tree export

#### Sessions & Cookies (9 tools)
- Cookie management (get, set, delete, clear)
- localStorage operations
- sessionStorage support
- Full session export/import
- Cross-session persistence

### 🛡️ Security
- Anti-detection measures
- Realistic browser fingerprinting
- Human-like interaction patterns

### 📚 Documentation
- Comprehensive README
- Usage examples
- Troubleshooting guide
- API documentation

### 🔧 Technical
- TypeScript implementation
- Zod schema validation
- Error handling
- Graceful shutdown
- Modular architecture

## [Unreleased]

### Planned Features
- Visual regression testing
- Network throttling
- Performance profiling
- Video recording
- Auto-recovery mechanisms
- Multi-profile support (future)
