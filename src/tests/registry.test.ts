import { describe, it, expect } from 'vitest';
import type { ChromeConnector } from '../chrome-connector.js';
import { buildToolRegistry, allTools, findDuplicateToolNames } from '../registry.js';

// Tool factories only touch the connector inside their (unexecuted) handler
// closures, so a minimal stand-in is enough to build the registry without a
// real browser. This test exists specifically to catch the class of bug
// that shipped in v1.2.0: two tools silently registered under the same
// name, where the last one wins and the other becomes unreachable.
const fakeConnector = {} as ChromeConnector;

describe('buildToolRegistry', () => {
  it('registers a non-trivial number of tools', () => {
    const registry = buildToolRegistry(fakeConnector);
    expect(allTools(registry).length).toBeGreaterThan(50);
  });

  it('never registers the same tool name twice', () => {
    const registry = buildToolRegistry(fakeConnector);
    expect(findDuplicateToolNames(registry)).toEqual([]);
  });

  it('gives every tool a name and a non-empty description', () => {
    const registry = buildToolRegistry(fakeConnector);
    for (const tool of allTools(registry)) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });
});
