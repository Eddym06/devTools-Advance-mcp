import { describe, it, expect } from 'vitest';
import { UriTemplate } from '@modelcontextprotocol/sdk/shared/uriTemplate.js';

// Unit-tests just the URI template strings used in resources.ts against the
// SDK's own matcher — catches a typo'd placeholder without needing a real
// Chrome instance (the read callbacks themselves are exercised manually /
// via the integration test's "no browser attached" path).
describe('resource URI templates', () => {
  const templates = [
    'chrome://tab/{tabId}/html',
    'chrome://tab/{tabId}/screenshot',
    'chrome://tab/{tabId}/har',
  ];

  it.each(templates)('extracts tabId from a concrete URI matching %s', (template) => {
    const suffix = template.split('/').pop();
    const uri = new UriTemplate(template).toString().replace('{tabId}', 'ABCD-1234');
    const match = new UriTemplate(template).match(uri);
    expect(match).toEqual({ tabId: 'ABCD-1234' });
    expect(uri).toBe(`chrome://tab/ABCD-1234/${suffix}`);
  });

  it('does not match a URI for a different resource kind', () => {
    const template = new UriTemplate('chrome://tab/{tabId}/html');
    expect(template.match('chrome://tab/ABCD-1234/screenshot')).toBeNull();
  });
});
