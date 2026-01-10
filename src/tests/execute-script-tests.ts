/**
 * Execute Script Testing Suite
 * Progressive tests from simple to complex
 */

export const executeScriptTests = [
  // ═══════════════════════════════════════════════════════════════
  // LEVEL 1: BASIC EXPRESSIONS (should all work)
  // ═══════════════════════════════════════════════════════════════
  {
    name: "Simple arithmetic",
    script: "return 1 + 1;",
    expectedResult: 2,
    timeoutMs: 5000
  },
  {
    name: "String concatenation",
    script: "return 'Hello' + ' ' + 'World';",
    expectedResult: "Hello World",
    timeoutMs: 5000
  },
  {
    name: "Get page title",
    script: "return document.title;",
    expectedResult: "<any string>",
    timeoutMs: 5000
  },
  {
    name: "Get URL",
    script: "return window.location.href;",
    expectedResult: "<url>",
    timeoutMs: 5000
  },
  {
    name: "Array creation",
    script: "return [1, 2, 3, 4, 5];",
    expectedResult: [1, 2, 3, 4, 5],
    timeoutMs: 5000
  },
  {
    name: "Object creation",
    script: "return {name: 'test', value: 123};",
    expectedResult: {name: 'test', value: 123},
    timeoutMs: 5000
  },
  
  // ═══════════════════════════════════════════════════════════════
  // LEVEL 2: DOM QUERIES (basic)
  // ═══════════════════════════════════════════════════════════════
  {
    name: "Count all elements",
    script: "return document.querySelectorAll('*').length;",
    expectedResult: "<number>",
    timeoutMs: 5000
  },
  {
    name: "Get all link hrefs",
    script: `
      return Array.from(document.querySelectorAll('a'))
        .map(a => a.href)
        .filter(href => href.startsWith('http'));
    `,
    expectedResult: "<array of urls>",
    timeoutMs: 10000
  },
  {
    name: "Get all button texts",
    script: `
      return Array.from(document.querySelectorAll('button'))
        .map(btn => btn.textContent.trim())
        .filter(text => text.length > 0);
    `,
    expectedResult: "<array of strings>",
    timeoutMs: 10000
  },
  
  // ═══════════════════════════════════════════════════════════════
  // LEVEL 3: COMPLEX QUERIES
  // ═══════════════════════════════════════════════════════════════
  {
    name: "Extract structured data",
    script: `
      return Array.from(document.querySelectorAll('article, .post, .item'))
        .slice(0, 10)
        .map(item => ({
          text: item.textContent.trim().substring(0, 100),
          links: Array.from(item.querySelectorAll('a')).length,
          images: Array.from(item.querySelectorAll('img')).length
        }));
    `,
    expectedResult: "<array of objects>",
    timeoutMs: 15000
  },
  {
    name: "Get form field info",
    script: `
      return Array.from(document.querySelectorAll('input, textarea, select'))
        .map(field => ({
          type: field.type || field.tagName,
          name: field.name || field.id,
          value: field.value ? '[has value]' : '[empty]'
        }));
    `,
    expectedResult: "<array of form fields>",
    timeoutMs: 10000
  },
  
  // ═══════════════════════════════════════════════════════════════
  // LEVEL 4: WINDOW OBJECT ACCESS
  // ═══════════════════════════════════════════════════════════════
  {
    name: "Check window variables",
    script: `
      return {
        hasJQuery: typeof window.jQuery !== 'undefined',
        hasReact: typeof window.React !== 'undefined',
        hasAngular: typeof window.angular !== 'undefined',
        hasVue: typeof window.Vue !== 'undefined'
      };
    `,
    expectedResult: "<object with boolean values>",
    timeoutMs: 5000
  },
  {
    name: "Get localStorage items",
    script: `
      const items = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        items[key] = localStorage.getItem(key).substring(0, 50);
      }
      return items;
    `,
    expectedResult: "<object>",
    timeoutMs: 5000
  },
  
  // ═══════════════════════════════════════════════════════════════
  // LEVEL 5: ASYNC OPERATIONS
  // ═══════════════════════════════════════════════════════════════
  {
    name: "Async timeout",
    script: `
      return new Promise(resolve => {
        setTimeout(() => resolve('Async completed'), 1000);
      });
    `,
    expectedResult: "Async completed",
    timeoutMs: 5000,
    awaitPromise: true
  },
  {
    name: "Fetch test (if available)",
    script: `
      if (typeof fetch === 'undefined') {
        return 'Fetch not available';
      }
      return 'Fetch available (use with caution in tests)';
    `,
    expectedResult: "<string>",
    timeoutMs: 5000
  },
  
  // ═══════════════════════════════════════════════════════════════
  // LEVEL 6: ERROR HANDLING TESTS (should fail gracefully)
  // ═══════════════════════════════════════════════════════════════
  {
    name: "Syntax error",
    script: "return this is invalid javascript;",
    expectedResult: "<error>",
    shouldFail: true,
    timeoutMs: 5000
  },
  {
    name: "Runtime error",
    script: "return undefinedVariable.property;",
    expectedResult: "<error>",
    shouldFail: true,
    timeoutMs: 5000
  },
  {
    name: "Return DOM node (should be handled)",
    script: "return document.body;",
    expectedResult: "[DOM Node - use get_text or get_attribute instead]",
    timeoutMs: 5000
  },
  {
    name: "Return function (should be handled)",
    script: "return function() { return 'test'; };",
    expectedResult: "[Function]",
    timeoutMs: 5000
  }
];

/**
 * Test runner instructions for AI
 */
export const testInstructions = `
EXECUTE_SCRIPT TESTING PROTOCOL

Prerequisites:
1. Chrome browser must be running (launch_chrome_with_profile)
2. Navigate to a test page (e.g., https://example.com or https://apple.com)

Testing Sequence:
1. Start with LEVEL 1 tests (simple expressions)
2. If all pass, proceed to LEVEL 2 (basic DOM)
3. Continue through levels progressively
4. Stop at first failure and report

For each test:
1. Call execute_script with the test script
2. Record: success/failure, result, execution time
3. Compare result with expected (if not error test)
4. Note any deviations or unexpected behavior

Expected Outcomes:
- LEVEL 1-2: Should have 100% success rate
- LEVEL 3-4: Should have >90% success rate
- LEVEL 5: May have some failures (network dependent)
- LEVEL 6: Should fail gracefully with error messages (not crash)

Failure Analysis:
If a test fails, check:
1. Is Chrome connection active? (list_tabs)
2. Is page loaded? (get_url, screenshot)
3. Is timeout sufficient? (increase timeoutMs)
4. Is error message descriptive?

Report Format:
{
  level: "LEVEL X",
  passed: X,
  failed: Y,
  total: Z,
  failures: [{test: "name", error: "message"}]
}
`;

/**
 * Real-world usage examples
 */
export const realWorldExamples = [
  {
    scenario: "Extract product prices from e-commerce",
    script: `
      return Array.from(document.querySelectorAll('.price, [data-price], .product-price'))
        .map(el => el.textContent.trim())
        .filter(text => text.match(/\\$|€|£/));
    `
  },
  {
    scenario: "Check if user is logged in",
    script: `
      return {
        hasLoginButton: !!document.querySelector('[href*="login"], button:contains("Login")'),
        hasUserMenu: !!document.querySelector('.user-menu, .profile-menu, [data-user]'),
        hasLogoutButton: !!document.querySelector('[href*="logout"], button:contains("Logout")')
      };
    `
  },
  {
    scenario: "Get all image URLs",
    script: `
      return Array.from(document.querySelectorAll('img'))
        .map(img => ({
          src: img.src,
          alt: img.alt,
          width: img.naturalWidth,
          height: img.naturalHeight
        }))
        .filter(img => img.width > 100);
    `
  },
  {
    scenario: "Inject console logger",
    script: `
      window.originalConsoleLog = console.log;
      window.logHistory = [];
      console.log = function(...args) {
        window.logHistory.push(args);
        window.originalConsoleLog.apply(console, args);
      };
      return 'Console logger injected. Access logs via window.logHistory';
    `
  }
];
