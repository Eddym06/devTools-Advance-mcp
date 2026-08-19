/**
 * Tool title/annotation derivation.
 *
 * With ~90 tools, hand-writing MCP tool annotations (readOnlyHint,
 * destructiveHint, idempotentHint, openWorldHint — spec 2025-03-26) one by
 * one is impractical. This derives sensible defaults from the naming
 * convention the codebase already follows (get_/list_/set_/clear_/...),
 * with an explicit override table for the composite "action enum" tools
 * (perform_interaction, browser_action, ...) and browser-lifecycle tools
 * where the name alone doesn't tell you enough.
 *
 * These are hints for client UX (e.g. "confirm before running"), not a
 * security boundary — refine per-tool over time as needed.
 */

export interface DerivedAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

const ACRONYMS = new Set([
  'html', 'url', 'urls', 'api', 'css', 'js', 'pdf', 'dom', 'cdp', 'har',
  'aria', 'json', 'sw', 'ui', 'http', 'https', 'id', 'ws',
]);

export function deriveTitle(name: string): string {
  return name
    .split('_')
    .map((word) => {
      if (ACRONYMS.has(word.toLowerCase())) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

type Hints = Omit<DerivedAnnotations, 'title'>;

// Explicit overrides for tools whose name doesn't fit the prefix heuristic,
// or where the default guess would be actively misleading.
const OVERRIDES: Record<string, Hints> = {
  // Arbitrary code / arbitrary target execution — treat as the most sensitive class.
  execute_script: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  execute_in_target: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },

  // Consolidated action-enum tools: behavior varies by `action`, default to "changes state".
  perform_interaction: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  browser_action: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  manage_tabs: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  manage_browser_session: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  wait_for_load_state: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },

  // Browser lifecycle / server-local control — not "open world" web interaction.
  launch_chrome_with_profile: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  close_browser: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  get_browser_status: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  show_advanced_tools: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  hide_advanced_tools: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },

  // Workflow tools that combine navigation + interaction + extraction.
  test_api_endpoint: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  test_with_different_cookies: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  simulate_user_journey: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  navigate_and_extract_content: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  extract_api_data: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  capture_network_on_action: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  intercept_and_modify_traffic: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  add_custom_header_to_request: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
};

const READ_ONLY_PREFIXES = ['get_', 'list_', 'inspect_'];
const DESTRUCTIVE_PREFIXES = ['close_', 'clear_', 'delete_', 'remove_', 'unregister_', 'kill_'];
const IDEMPOTENT_PREFIXES = ['set_', 'clear_', 'delete_', 'remove_', 'unregister_', 'disable_', 'enable_'];

function deriveDefaultHints(name: string): Hints {
  const readOnlyHint = READ_ONLY_PREFIXES.some((p) => name.startsWith(p));
  const destructiveHint = !readOnlyHint && DESTRUCTIVE_PREFIXES.some((p) => name.startsWith(p));
  const idempotentHint = readOnlyHint || IDEMPOTENT_PREFIXES.some((p) => name.startsWith(p));

  return {
    readOnlyHint,
    destructiveHint,
    idempotentHint,
    // This server's entire purpose is driving a live browser against the
    // open web, so default true; the few purely-local exceptions are overridden above.
    openWorldHint: true,
  };
}

export function deriveAnnotations(name: string): DerivedAnnotations {
  const hints = OVERRIDES[name] ?? deriveDefaultHints(name);
  return { title: deriveTitle(name), ...hints };
}
