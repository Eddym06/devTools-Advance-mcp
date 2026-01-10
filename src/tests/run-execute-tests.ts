#!/usr/bin/env node

/**
 * Automated Execute Script Testing
 * Run this after building to verify execute_script works correctly
 */

import { executeScriptTests, testInstructions } from './execute-script-tests.js';

console.log('🧪 EXECUTE_SCRIPT TESTING SUITE');
console.log('═'.repeat(80));
console.log('\n' + testInstructions + '\n');
console.log('═'.repeat(80));

console.log('\n📋 TEST DEFINITIONS LOADED\n');

// Group tests by level
const testsByLevel: Record<string, any[]> = {
  'LEVEL 1: BASIC EXPRESSIONS': [],
  'LEVEL 2: DOM QUERIES (basic)': [],
  'LEVEL 3: COMPLEX QUERIES': [],
  'LEVEL 4: WINDOW OBJECT ACCESS': [],
  'LEVEL 5: ASYNC OPERATIONS': [],
  'LEVEL 6: ERROR HANDLING': []
};

let currentLevel = 'LEVEL 1: BASIC EXPRESSIONS';
executeScriptTests.forEach((test, index) => {
  if (index === 6) currentLevel = 'LEVEL 2: DOM QUERIES (basic)';
  if (index === 9) currentLevel = 'LEVEL 3: COMPLEX QUERIES';
  if (index === 11) currentLevel = 'LEVEL 4: WINDOW OBJECT ACCESS';
  if (index === 13) currentLevel = 'LEVEL 5: ASYNC OPERATIONS';
  if (index === 15) currentLevel = 'LEVEL 6: ERROR HANDLING';
  
  testsByLevel[currentLevel].push(test);
});

// Print test summary
Object.entries(testsByLevel).forEach(([level, tests]) => {
  console.log(`\n${level}`);
  console.log('─'.repeat(80));
  tests.forEach((test, i) => {
    const status = test.shouldFail ? '⚠️ ' : '✓ ';
    console.log(`  ${status}${i + 1}. ${test.name}`);
    console.log(`     Script: ${test.script.trim().substring(0, 60)}...`);
    console.log(`     Timeout: ${test.timeoutMs}ms`);
    if (test.shouldFail) {
      console.log(`     Expected: Error (graceful failure)`);
    }
  });
});

console.log('\n\n' + '═'.repeat(80));
console.log('📝 TESTING INSTRUCTIONS');
console.log('═'.repeat(80));
console.log(`
To run these tests manually with the MCP:

1. Start MCP server: npm run build && node dist/index.js
2. Connect via MCP client (VS Code Copilot)
3. Execute these commands in order:

   # Setup
   launch_chrome_with_profile()
   navigate({ url: "https://example.com" })
   wait_for_load_state({ state: "networkidle" })

   # Run Level 1 tests (copy one by one)
   execute_script({ script: "return 1 + 1;", timeoutMs: 5000 })
   execute_script({ script: "return 'Hello' + ' ' + 'World';", timeoutMs: 5000 })
   execute_script({ script: "return document.title;", timeoutMs: 5000 })
   
   # ... etc

4. Record results in this format:
   {
     test: "Simple arithmetic",
     expected: 2,
     actual: 2,
     success: true,
     timeMs: 45
   }

5. Report any failures with full error messages

AUTOMATED TESTING (if MCP client supports it):
You can also use the MCP programmatically to run all tests in sequence.
See the executeScriptTests array for the complete test suite.
`);

console.log('\n✅ Test definitions ready. Total tests: ' + executeScriptTests.length);
console.log('✅ To execute, run tests manually through MCP or use automated test runner\n');
