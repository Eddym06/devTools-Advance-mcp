declare module 'chrome-remote-interface' {
  interface CDPClient {
    send(method: string, params?: any): Promise<any>;
    close(): Promise<void>;
    [domain: string]: any;
  }

  interface CDPOptions {
    port?: number;
    host?: string;
    target?: string | ((targets: any[]) => any);
  }

  interface CDPTarget {
    id: string;
    type: string;
    title: string;
    url: string;
    description?: string;
  }

  interface CDPVersion {
    Browser: string;
    'Protocol-Version': string;
    'User-Agent': string;
    'V8-Version': string;
    'WebKit-Version': string;
    webSocketDebuggerUrl: string;
  }

  function CDP(options?: CDPOptions): Promise<CDPClient>;

  namespace CDP {
    function List(options?: { port?: number; host?: string }): Promise<CDPTarget[]>;
    function New(options?: { port?: number; host?: string; url?: string }): Promise<CDPTarget>;
    function Close(options: { port?: number; host?: string; id: string }): Promise<void>;
    function Activate(options: { port?: number; host?: string; id: string }): Promise<void>;
    function Version(options?: { port?: number; host?: string }): Promise<CDPVersion>;
  }

  export = CDP;
}
