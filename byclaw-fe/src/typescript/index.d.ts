// --no-ignore

declare global {
  interface Window {
    webkitCrypto?: Crypto;
    mozCrypto?: Crypto;
    oCrypto?: Crypto;
    msCrypto?: Crypto;
  }
}

/** 全局類型聲明域 */
declare namespace TS {

  // 使用更具体的类型替代any
  type Any = unknown;

  type Null<T = unknown> = null | T;

  /** 可能是某类型 T */
  type Or<T = unknown> = undefined | T;

  /** 属性链 */
  type Keys<T> = T extends {}
    ?
    {
      [K in keyof T]-?: K extends string ? `${K}` | `${K}.${Keys<T[K]> extends string ? Keys<T[K]> : never}` : never;
    }[keyof T]
    : never;

  /** 屬性值類型 */
  type Get<T extends {}, P extends Keys<T>> =
    P extends `${infer K}.${infer R}`
    ? K extends keyof T ? Get<T[K] & {}, R> : never
    : P extends keyof T ? Or<T[P]> : never;

}
