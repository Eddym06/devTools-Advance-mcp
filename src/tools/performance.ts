/**
 * Performance & Network Emulation Tools
 */

import { z } from 'zod';
import type { ChromeConnector } from '../chrome-connector.js';

type Rating = 'good' | 'needs-improvement' | 'poor' | 'unknown';

function rate(value: number | null, [good, poor]: [number, number]): Rating {
  if (value === null || value === undefined) return 'unknown';
  if (value <= good) return 'good';
  if (value <= poor) return 'needs-improvement';
  return 'poor';
}

// Approximate Chrome DevTools throttling profiles (kbps / ms). Not
// certified benchmarks — good enough to exercise resilience under bad
// network conditions, which is the point of this tool.
const NETWORK_PRESETS: Record<
  string,
  { offline: boolean; latency: number; downloadThroughput: number; uploadThroughput: number }
> = {
  offline: { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 },
  'slow-3g': { offline: false, latency: 2000, downloadThroughput: (500 * 1024) / 8, uploadThroughput: (500 * 1024) / 8 },
  'fast-3g': { offline: false, latency: 562, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 },
  '4g': { offline: false, latency: 170, downloadThroughput: (4 * 1024 * 1024) / 8, uploadThroughput: (3 * 1024 * 1024) / 8 },
  none: { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
};

export function createPerformanceTools(connector: ChromeConnector) {
  return [
    {
      name: 'run_performance_audit',
      description:
        'Capture Core Web Vitals (LCP, CLS) and basic timing (TTFB, FCP, long tasks, JS heap) for the current page ' +
        'using the PerformanceObserver API. Best called right after navigating, before other interactions.',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)'),
        observeMs: z.number().default(4000).describe('How long to observe for LCP/layout-shift updates before reporting'),
      }),
      handler: async ({ tabId, observeMs = 4000 }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Runtime, Performance } = client;
        await Runtime.enable();
        await Performance.enable();

        const script = `new Promise((resolve) => {
          const metrics = { lcp: null, cls: 0, ttfb: null, fcp: null, longTasks: 0 };
          try {
            const nav = performance.getEntriesByType('navigation')[0];
            if (nav) metrics.ttfb = nav.responseStart;
            const fcpEntry = performance.getEntriesByName('first-contentful-paint')[0];
            if (fcpEntry) metrics.fcp = fcpEntry.startTime;
          } catch (e) {}

          try {
            new PerformanceObserver((list) => {
              const entries = list.getEntries();
              const last = entries[entries.length - 1];
              if (last) metrics.lcp = last.renderTime || last.loadTime || last.startTime;
            }).observe({ type: 'largest-contentful-paint', buffered: true });
          } catch (e) {}

          try {
            new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) {
                if (!entry.hadRecentInput) metrics.cls += entry.value;
              }
            }).observe({ type: 'layout-shift', buffered: true });
          } catch (e) {}

          try {
            new PerformanceObserver((list) => {
              metrics.longTasks += list.getEntries().length;
            }).observe({ type: 'longtask', buffered: true });
          } catch (e) {}

          setTimeout(() => resolve(metrics), ${observeMs});
        })`;

        const result: any = await Runtime.evaluate({ expression: script, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) {
          throw new Error(`Performance audit failed: ${result.exceptionDetails.exception?.description || 'unknown error'}`);
        }

        const vitals = result.result.value;
        const cdpMetrics = await Performance.getMetrics();
        const heap = cdpMetrics.metrics.find((m: any) => m.name === 'JSHeapUsedSize');

        return {
          success: true,
          observedForMs: observeMs,
          webVitals: {
            lcpMs: vitals.lcp,
            cls: vitals.cls,
            ttfbMs: vitals.ttfb,
            fcpMs: vitals.fcp,
            longTaskCount: vitals.longTasks,
          },
          rating: {
            lcp: rate(vitals.lcp, [2500, 4000]),
            cls: rate(vitals.cls, [0.1, 0.25]),
          },
          jsHeapUsedBytes: heap ? heap.value : undefined,
        };
      },
    },
    {
      name: 'emulate_network_conditions',
      description:
        'Throttle network speed/latency for a tab (e.g. "slow-3g") to test resilience under bad connectivity, or ' +
        'go "offline". Use preset="none" to remove throttling.',
      inputSchema: z.object({
        preset: z
          .enum(['offline', 'slow-3g', 'fast-3g', '4g', 'none', 'custom'])
          .default('slow-3g')
          .describe('Named throttling profile, or "custom" to use the latency/throughput fields below'),
        latencyMs: z.number().optional().describe('Custom: extra round-trip latency in ms (preset="custom")'),
        downloadThroughputKbps: z.number().optional().describe('Custom: max download throughput in kbps (preset="custom")'),
        uploadThroughputKbps: z.number().optional().describe('Custom: max upload throughput in kbps (preset="custom")'),
        tabId: z.string().optional().describe('Tab ID (optional)'),
      }),
      handler: async ({ preset = 'slow-3g', latencyMs, downloadThroughputKbps, uploadThroughputKbps, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Network } = client;
        await Network.enable();

        const conditions =
          preset === 'custom'
            ? {
                offline: false,
                latency: latencyMs ?? 0,
                downloadThroughput: downloadThroughputKbps ? (downloadThroughputKbps * 1024) / 8 : -1,
                uploadThroughput: uploadThroughputKbps ? (uploadThroughputKbps * 1024) / 8 : -1,
              }
            : NETWORK_PRESETS[preset];

        await Network.emulateNetworkConditions(conditions);

        return {
          success: true,
          preset,
          appliedConditions: conditions,
          message: preset === 'none' ? 'Network throttling reset to normal' : `Network throttling set to "${preset}"`,
        };
      },
    },
  ];
}
