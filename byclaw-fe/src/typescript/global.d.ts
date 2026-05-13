import type * as AntdIcons from '@ant-design/icons';
import type { useParams } from 'react-router';

declare module '@umijs/max' {
  export function getIntl(): { 
    formatMessage: (options: { id: string, defaultMessage?: string }, param?: Record<string, unknown>) => string 
  };
  export function useIntl(): { 
    formatMessage: (options: { id: string, defaultMessage?: string }, param?: Record<string, unknown>) => string 
  };

  export function getLocale(): string;

  export function setLocale(lang: string, realReload?: boolean): void;
  export function useLocation(): { pathname: string; search: string; hash: string; state: unknown };
  export function useSearchParams(): [URLSearchParams, (params: URLSearchParams) => void];

  export function useDispatch(): (param: { type: string; payload?: unknown, success?: (res: any) => void, fail?: (err: any) => void }) => any;
  export function useSelector<T>(param: (state: any) => T): T;
  export function useParams<T>(): T;
  export function useNavigate(): any;

  export function connect(): JSX.Element;
  export function connect<T>(param: (state: any) => T): JSX.Element;
  export function connect<T>(param: (state: any) => T, mapDispatchToProps?: (dispatch: any) => any): JSX.Element;
  export function connect<T>(param: (state: any) => T, mapDispatchToProps?: null | ((dispatch: any) => any), mapStateToProps?: null | ((state: any) => any)): JSX.Element;
  export function connect<T>(param: (state: any) => T, mapDispatchToProps?: null | ((dispatch: any) => any), mapStateToProps?: null | ((state: any) => any), mergeProps?: (state: any) => any): JSX.Element;
  export function connect<T>(param: (state: any) => T, mapDispatchToProps?: null | ((dispatch: any) => any), mapStateToProps?: null | ((state: any) => any), mergeProps?: { forwardRef?: boolean }, forwardRef?: boolean): JSX.Element;

  export function getDvaApp(): any;

  export const history: any;
}

declare global {
  interface Window {
    React: typeof import('react');
    ReactDOM: typeof import('react-dom');
    antd: typeof import('antd');
    icons: typeof AntdIcons;
    umami?: {
      track: (eventName: string, eventData?: Record<string, unknown>) => void;
    };
    webkitAudioContext: typeof window.AudioContext;
    [key in string]: unknown;
  }
}

export {};
