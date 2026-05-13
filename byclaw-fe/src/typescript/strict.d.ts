/**
 * 严格类型定义 - 替代any类型
 */

// 基础类型定义
export type UnknownRecord = Record<string, unknown>;
export type StringRecord = Record<string, string>;
export type NumberRecord = Record<string, number>;
export type BooleanRecord = Record<string, boolean>;

// 事件类型定义
export type EventHandler<T = Event> = (event: T) => void;
export type ChangeEventHandler<T = HTMLInputElement> = (event: React.ChangeEvent<T>) => void;
export type ClickEventHandler<T = HTMLElement> = (event: React.MouseEvent<T>) => void;
export type KeyboardEventHandler<T = HTMLElement> = (event: React.KeyboardEvent<T>) => void;


// 工具函数类型
export type ValueOf<T> = T[keyof T];
export type NonNullable<T> = T extends null | undefined ? never : T;
export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
export type Required<T, K extends keyof T> = T & { [P in K]-?: T[P] };

// 函数类型
export type AsyncFunction<T = unknown, R = unknown> = (params: T) => Promise<R>;
export type SyncFunction<T = unknown, R = unknown> = (params: T) => R;
export type VoidFunction = () => void;
export type AsyncVoidFunction = () => Promise<void>;

// 深度只读类型
export type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
};

// 深度可选类型
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

// 数组工具类型
export type NonEmptyArray<T> = [T, ...T[]];
export type ArrayElement<T> = T extends (infer U)[] ? U : never;

// 对象工具类型
export type KeysOfType<T, U> = {
  [K in keyof T]: T[K] extends U ? K : never;
}[keyof T];

export type PickByType<T, U> = Pick<T, KeysOfType<T, U>>;
export type OmitByType<T, U> = Omit<T, KeysOfType<T, U>>;
