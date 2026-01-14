#!/usr/bin/env node

/**
 * Tool Verification Script
 * Verifies that all tools are properly exposed by the MCP server
 */

import { createNavigationTools } from './tools/navigation.js';
import { createInteractionTools } from './tools/interaction.js';
import { createAdvancedNetworkTools } from './tools/advanced-network.js';
import { ChromeConnector } from './chrome-connector.js';

// Mock connector (we don't need real Chrome connection for this test)
const mockConnector = {} as ChromeConnector;

console.log('🔍 Verifying MCP Tool Exposure...\n');

// Collect all tools
const allTools = [
  ...createNavigationTools(mockConnector),
  ...createInteractionTools(mockConnector),
  ...createAdvancedNetworkTools(mockConnector),
];

// Group by category
const toolsByCategory = {
  navigation: createNavigationTools(mockConnector),
  interaction: createInteractionTools(mockConnector),
  advancedNetwork: createAdvancedNetworkTools(mockConnector)
};

// Print summary
console.log('📊 TOOL SUMMARY');
console.log('═'.repeat(80));
console.log(`Total Tools: ${allTools.length}\n`);

for (const [category, tools] of Object.entries(toolsByCategory)) {
  console.log(`\n${category.toUpperCase()} (${tools.length} tools):`);
  console.log('─'.repeat(80));
  tools.forEach((tool, index) => {
    console.log(`  ${index + 1}. ${tool.name}`);
  });
}

// Verify critical interception tools
console.log('\n\n🔍 CRITICAL INTERCEPTION TOOLS VERIFICATION');
console.log('═'.repeat(80));

const criticalTools = [
  'enable_response_interception',
  'list_intercepted_responses',
  'modify_intercepted_response',
  'disable_response_interception',
  'continue_intercepted_request',
  'fail_intercepted_request'
];

const toolMap = new Map(allTools.map(t => [t.name, t]));

let allFound = true;
criticalTools.forEach(toolName => {
  const found = toolMap.has(toolName);
  const status = found ? '✅' : '❌';
  console.log(`${status} ${toolName}`);
  
  if (found) {
    const tool = toolMap.get(toolName)!;
    console.log(`   Description: ${tool.description.substring(0, 100)}...`);
  } else {
    console.log(`   ⚠️  MISSING! This tool should exist but wasn't found!`);
    allFound = false;
  }
  console.log();
});

// Verify navigation tools
console.log('\n🧭 NAVIGATION TOOLS VERIFICATION');
console.log('═'.repeat(80));

const navigationTools = ['navigate', 'create_tab', 'go_back', 'go_forward', 'reload'];
navigationTools.forEach(toolName => {
  const found = toolMap.has(toolName);
  const status = found ? '✅' : '❌';
  console.log(`${status} ${toolName}`);
  
  if (found && toolName === 'navigate') {
    const tool = toolMap.get(toolName)!;
    // Check if description includes PRIMARY NAVIGATION TOOL
    if (tool.description.includes('PRIMARY NAVIGATION TOOL')) {
      console.log('   ✅ Description includes "PRIMARY NAVIGATION TOOL"');
    } else {
      console.log('   ⚠️  Description missing "PRIMARY NAVIGATION TOOL" marker');
      allFound = false;
    }
  }
  
  if (found && toolName === 'create_tab') {
    const tool = toolMap.get(toolName)!;
    // Check if description warns against using for simple navigation
    if (tool.description.includes('DO NOT USE for simple navigation')) {
      console.log('   ✅ Description includes "DO NOT USE for simple navigation"');
    } else {
      console.log('   ⚠️  Description missing navigation warning');
      allFound = false;
    }
  }
});

// Verify interaction tools have workflows
console.log('\n\n🖱️  INTERACTION TOOLS WORKFLOW VERIFICATION');
console.log('═'.repeat(80));

const interactionTools = ['click', 'type', 'get_html', 'screenshot'];
interactionTools.forEach(toolName => {
  const found = toolMap.has(toolName);
  const status = found ? '✅' : '❌';
  console.log(`${status} ${toolName}`);
  
  if (found) {
    const tool = toolMap.get(toolName)!;
    
    if (toolName === 'click' || toolName === 'type') {
      // Should have get_html prerequisite
      if (tool.description.includes('get_html') || tool.description.includes('PREREQUISITE')) {
        console.log('   ✅ Has get_html prerequisite in description');
      } else {
        console.log('   ⚠️  Missing get_html prerequisite warning');
        allFound = false;
      }
    }
    
    if (toolName === 'get_html') {
      // Should mention it's for analysis before interaction
      if (tool.description.includes('CRITICAL') || tool.description.includes('BEFORE')) {
        console.log('   ✅ Marked as critical for pre-interaction analysis');
      } else {
        console.log('   ⚠️  Missing critical analysis marker');
        allFound = false;
      }
    }
  }
});

// Final verdict
console.log('\n\n' + '═'.repeat(80));
if (allFound) {
  console.log('✅ ALL TOOLS VERIFIED SUCCESSFULLY!');
  console.log('✅ All critical tools exist and have proper descriptions');
  process.exit(0);
} else {
  console.log('❌ VERIFICATION FAILED!');
  console.log('❌ Some tools are missing or have incorrect descriptions');
  process.exit(1);
}
