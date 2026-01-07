/**
 * Type definitions for Custom Chrome MCP
 */

export interface ChromeConnection {
  client: any;
  connected: boolean;
  port: number;
}

export interface TabInfo {
  id: string;
  type: string;
  title: string;
  url: string;
  description?: string;
}

export interface ServiceWorkerInfo {
  registrationId: string;
  scopeURL: string;
  scriptURL: string;
  status: string;
  versionId: string;
  runningStatus?: string;
}

export interface CaptureOptions {
  format?: 'png' | 'jpeg';
  quality?: number;
  fullPage?: boolean;
  clip?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface NetworkRequest {
  requestId: string;
  url: string;
  method: string;
  status?: number;
  statusText?: string;
  headers: Record<string, string>;
  timestamp: number;
}

export interface ConsoleMessage {
  type: 'log' | 'warning' | 'error' | 'info' | 'debug';
  text: string;
  timestamp: number;
  url?: string;
  lineNumber?: number;
}

export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface SessionData {
  cookies: Cookie[];
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
  timestamp: number;
}

export interface PerformanceMetrics {
  firstContentfulPaint?: number;
  largestContentfulPaint?: number;
  timeToInteractive?: number;
  totalBlockingTime?: number;
  cumulativeLayoutShift?: number;
  timestamp: number;
}
