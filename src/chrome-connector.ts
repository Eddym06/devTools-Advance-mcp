/**
 * Chrome Connection Manager
 * Handles connection to existing Chrome instance via CDP
 */

import CDP from 'chrome-remote-interface';

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

export class ChromeConnector {
  private connection: ChromeConnection | null = null;
  private port: number;
  private currentTabId: string | null = null;

  constructor(port: number = 9222) {
    this.port = port;
  }

  /**
   * Connect to existing Chrome instance
   */
  async connect(): Promise<void> {
    try {
      const client = await CDP({ port: this.port });
      
      this.connection = {
        client,
        connected: true,
        port: this.port
      };

      console.error(`✅ Connected to Chrome on port ${this.port}`);
    } catch (error) {
      const err = error as Error;
      throw new Error(
        `Failed to connect to Chrome on port ${this.port}. ` +
        `Make sure Chrome is running with --remote-debugging-port=${this.port}\n` +
        `Error: ${err.message}`
      );
    }
  }

  /**
   * Disconnect from Chrome
   */
  async disconnect(): Promise<void> {
    if (this.connection?.client) {
      await this.connection.client.close();
      this.connection = null;
      console.error('Disconnected from Chrome');
    }
  }

  /**
   * Get current connection
   */
  getConnection(): ChromeConnection {
    if (!this.connection?.connected) {
      throw new Error('Not connected to Chrome. Call connect() first.');
    }
    return this.connection;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connection?.connected ?? false;
  }

  /**
   * List all open tabs
   */
  async listTabs(): Promise<TabInfo[]> {
    try {
      const targets = await CDP.List({ port: this.port });
      
      return targets
        .filter((t: any) => t.type === 'page')
        .map((t: any) => ({
          id: t.id,
          type: t.type,
          title: t.title,
          url: t.url,
          description: t.description
        }));
    } catch (error) {
      throw new Error(`Failed to list tabs: ${(error as Error).message}`);
    }
  }

  /**
   * Get active tab
   */
  async getActiveTab(): Promise<TabInfo | null> {
    const tabs = await this.listTabs();
    return tabs.length > 0 ? tabs[0] : null;
  }

  /**
   * Create new tab
   */
  async createTab(url?: string): Promise<TabInfo> {
    try {
      const newTab = await CDP.New({ port: this.port, url });
      
      return {
        id: newTab.id,
        type: newTab.type,
        title: newTab.title || '',
        url: newTab.url || url || 'about:blank'
      };
    } catch (error) {
      throw new Error(`Failed to create tab: ${(error as Error).message}`);
    }
  }

  /**
   * Close tab
   */
  async closeTab(tabId: string): Promise<void> {
    try {
      await CDP.Close({ port: this.port, id: tabId });
    } catch (error) {
      throw new Error(`Failed to close tab: ${(error as Error).message}`);
    }
  }

  /**
   * Activate tab
   */
  async activateTab(tabId: string): Promise<void> {
    try {
      await CDP.Activate({ port: this.port, id: tabId });
      this.currentTabId = tabId;
    } catch (error) {
      throw new Error(`Failed to activate tab: ${(error as Error).message}`);
    }
  }

  /**
   * Get CDP client for specific tab
   */
  async getTabClient(tabId?: string): Promise<any> {
    try {
      const target = tabId || this.currentTabId;
      
      if (!target) {
        // Get the first available tab
        const tabs = await this.listTabs();
        if (tabs.length === 0) {
          throw new Error('No tabs available');
        }
        return await CDP({ port: this.port, target: tabs[0].id });
      }
      
      return await CDP({ port: this.port, target });
    } catch (error) {
      throw new Error(`Failed to get tab client: ${(error as Error).message}`);
    }
  }

  /**
   * Execute CDP command
   */
  async executeCommand(domain: string, method: string, params?: any): Promise<any> {
    const client = this.getConnection().client;
    
    try {
      const result = await client.send(`${domain}.${method}`, params);
      return result;
    } catch (error) {
      throw new Error(`CDP command failed: ${domain}.${method} - ${(error as Error).message}`);
    }
  }

  /**
   * Get Chrome version info
   */
  async getVersion(): Promise<any> {
    try {
      const version = await CDP.Version({ port: this.port });
      return version;
    } catch (error) {
      throw new Error(`Failed to get Chrome version: ${(error as Error).message}`);
    }
  }

  /**
   * Get current port
   */
  getPort(): number {
    return this.port;
  }

  /**
   * Set current tab
   */
  setCurrentTab(tabId: string): void {
    this.currentTabId = tabId;
  }

  /**
   * Get current tab ID
   */
  getCurrentTabId(): string | null {
    return this.currentTabId;
  }
}
