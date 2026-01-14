#!/usr/bin/env node

/**
 * Script para listar todas las herramientas disponibles
 */

import { ChromeConnector } from './build/chrome-connector.js';
import { createNavigationTools } from './build/tools/navigation.js';
import { createInteractionTools } from './build/tools/interaction.js';
import { createAntiDetectionTools } from './build/tools/anti-detection.js';
import { createServiceWorkerTools } from './build/tools/service-worker.js';
import { createCaptureTools } from './build/tools/capture.js';
import { createSessionTools } from './build/tools/session.js';
import { createSystemTools } from './build/tools/system.js';
import { createPlaywrightLauncherTools } from './build/tools/playwright-launcher.js';
import { createNetworkAccessibilityTools } from './build/tools/network-accessibility.js';
import { createAdvancedNetworkTools } from './build/tools/advanced-network.js';

const connector = new ChromeConnector(9222);

const allTools = [
  ...createNetworkAccessibilityTools(connector),
  ...createAdvancedNetworkTools(connector),
  ...createPlaywrightLauncherTools(connector),
  ...createNavigationTools(connector),
  ...createInteractionTools(connector),
  ...createAntiDetectionTools(connector),
  ...createServiceWorkerTools(connector),
  ...createCaptureTools(connector),
  ...createSessionTools(connector),
  ...createSystemTools(connector),
];

console.log('\n=== HERRAMIENTAS CUSTOM-CHROME-MCP ===\n');
console.log(`Total: ${allTools.length} herramientas\n`);

// Agrupar por categoría
const categories = {
  'Network Interception (Requests)': [],
  'Network Interception (Responses)': [],
  'Mock API': [],
  'WebSocket': [],
  'HAR Recording': [],
  'Advanced Patterns': [],
  'Playwright': [],
  'Navigation': [],
  'Interaction': [],
  'Anti-Detection': [],
  'Service Workers': [],
  'Capture': [],
  'Session': [],
  'System': [],
  'Accessibility': [],
  'Other': []
};

allTools.forEach((tool, index) => {
  const name = tool.name;
  
  if (name.includes('_request') || name.includes('enable_network') || name === 'replay_intercepted_request') {
    categories['Network Interception (Requests)'].push({ index: index + 1, name });
  } else if (name.includes('_response') || name.includes('response_interception')) {
    categories['Network Interception (Responses)'].push({ index: index + 1, name });
  } else if (name.includes('mock')) {
    categories['Mock API'].push({ index: index + 1, name });
  } else if (name.includes('websocket')) {
    categories['WebSocket'].push({ index: index + 1, name });
  } else if (name.includes('har')) {
    categories['HAR Recording'].push({ index: index + 1, name });
  } else if (name.includes('pattern') || name.includes('injection')) {
    categories['Advanced Patterns'].push({ index: index + 1, name });
  } else if (name.includes('launch') || name.includes('playwright') || name.includes('browser')) {
    categories['Playwright'].push({ index: index + 1, name });
  } else if (name.includes('navigate') || name.includes('tab')) {
    categories['Navigation'].push({ index: index + 1, name });
  } else if (name.includes('click') || name.includes('type') || name.includes('scroll')) {
    categories['Interaction'].push({ index: index + 1, name });
  } else if (name.includes('stealth') || name.includes('detection')) {
    categories['Anti-Detection'].push({ index: index + 1, name });
  } else if (name.includes('service_worker')) {
    categories['Service Workers'].push({ index: index + 1, name });
  } else if (name.includes('capture') || name.includes('screenshot') || name.includes('pdf')) {
    categories['Capture'].push({ index: index + 1, name });
  } else if (name.includes('cookie') || name.includes('session') || name.includes('storage')) {
    categories['Session'].push({ index: index + 1, name });
  } else if (name.includes('extension') || name.includes('target')) {
    categories['System'].push({ index: index + 1, name });
  } else if (name.includes('accessibility')) {
    categories['Accessibility'].push({ index: index + 1, name });
  } else {
    categories['Other'].push({ index: index + 1, name });
  }
});

// Imprimir por categorías
Object.entries(categories).forEach(([category, tools]) => {
  if (tools.length > 0) {
    console.log(`\n📦 ${category} (${tools.length}):`);
    tools.forEach(tool => {
      console.log(`   ${tool.index}. ${tool.name}`);
    });
  }
});

console.log('\n');

// Verificar herramientas críticas
const criticalTools = [
  'list_intercepted_requests',
  'replay_intercepted_request',
  'list_intercepted_responses',
  'enable_network_interception',
  'enable_response_interception'
];

console.log('🔍 Verificación de herramientas críticas:\n');
criticalTools.forEach(toolName => {
  const found = allTools.find(t => t.name === toolName);
  const index = allTools.findIndex(t => t.name === toolName);
  if (found) {
    console.log(`   ✅ ${toolName} (posición ${index + 1}/${allTools.length})`);
  } else {
    console.log(`   ❌ ${toolName} - NO ENCONTRADA`);
  }
});

console.log('\n');
