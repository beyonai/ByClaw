// 增加 CSS/LESS 模块声明
declare module '*.less' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module '*.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module '*.png' {
  const src: string;
  export default src;
}

declare module '*.gif' {
  const src: string;
  export default src;
}

// declare module '*.png' {
//   const classes: { readonly [key: string]: string };
//   export default classes;
// }

declare module '*.svg' {
  import React = require('react');
  export const ReactComponent: React.FC<React.SVGProps<SVGSVGElement>>;
  const src: string;
  export default src;
}

// 声明全局变量
declare const _PUBLIC_PATH_: string;
declare const PREFIX_NAME: string;
declare const BUILD_TIME: string;
declare const URI_TARGET: string;
declare const ICONFONT_FILE_NAME: string;

interface ICrypto {
  webkitCrypto?: Crypto;
  msCrypto?: Crypto;
  mozCrypto?: Crypto;
  oCrypto?: Crypto;
  crypto?: Crypto;
}

// 声明 Umi 全局变量
interface Window extends ICrypto {
  VConsole: any;
  g_app: {
    _store: any;
    dispatch: (action: any) => any;
  };
  g_umi: {
    version: string;
  };
  umiDispatch: any;
  publicPath: string;
  routerBase: string;
}

declare module '@uehreka/seriously/build/seriously.module.js' {
  export default any;
}

declare module 'react-json-prettify' {
  import * as React from 'react';

  export interface JsonPrettyTheme {
    background?: string;
    brace?: string;
    keyQuotes?: string;
    valueQuotes?: string;
    colon?: string;
    comma?: string;
    key?: string;
    bracket?: string;
    value?: {
      string?: string | ((value: string) => string);
      null?: string | ((value: null) => string);
      number?: string | ((value: number) => string);
      boolean?: string | ((value: boolean) => string);
    };
  }

  export interface JsonPrettyProps {
    json: Record<string, any> | any[] | null;
    theme?: JsonPrettyTheme;
    padding?: number;
  }

  const JSONPretty: React.FC<JsonPrettyProps>;
  export default JSONPretty;
}

declare module 'react-json-prettify/dist/themes' {
  import { JsonPrettyTheme } from 'react-json-prettify';

  export const github: JsonPrettyTheme;
}
