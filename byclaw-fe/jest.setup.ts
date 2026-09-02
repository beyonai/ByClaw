import '@testing-library/jest-dom';
import { TextDecoder, TextEncoder as NodeTextEncoder } from 'util';

// Node 的 TextEncoder 与 Jest/JSDOM 可能运行在不同的 VM realm 中。直接注入
// NodeTextEncoder 时，其 encode() 结果无法通过当前 realm 的 Uint8Array instanceof
// 检查，esbuild 会因此拒绝启动。复制到当前 realm 后再暴露给测试环境。
class TextEncoder extends NodeTextEncoder {
  encode(input?: string): Uint8Array {
    return Uint8Array.from(super.encode(input));
  }
}

Object.defineProperty(globalThis, 'TextEncoder', {
  value: TextEncoder,
  configurable: true,
  writable: true,
});

Object.defineProperty(globalThis, 'TextDecoder', {
  value: TextDecoder,
  configurable: true,
  writable: true,
});

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'TextEncoder', {
    value: TextEncoder,
    configurable: true,
    writable: true,
  });

  Object.defineProperty(window, 'TextDecoder', {
    value: TextDecoder,
    configurable: true,
    writable: true,
  });

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });
}
