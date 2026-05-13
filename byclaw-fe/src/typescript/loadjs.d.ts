declare module 'loadjs' {
  interface LoadJSOptions {
    success?: () => void;
    error?: (depsNotFound: string[]) => void;
    before?: (path: string, scriptEl: HTMLElement) => boolean | void;
    async?: boolean;
    numRetries?: number;
  }

  interface LoadJS {
    (files: string | string[], bundleId?: string, options?: LoadJSOptions): void;
    isDefined(bundleId: string): boolean;
    ready(bundleId: string, callback: Function): void;
    done(bundleId: string): void;
  }

  const loadjs: LoadJS;
  export = loadjs;
} 