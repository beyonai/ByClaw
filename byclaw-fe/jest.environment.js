const Module = require('module');

const originalLoad = Module._load;

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'canvas') {
    return {};
  }

  return originalLoad.call(this, request, parent, isMain);
};

const { TextEncoder, TextDecoder } = require('util');
const JSDOMEnvironment = require('jest-environment-jsdom').TestEnvironment;

// jsdom 的全局 Uint8Array 与 Node util.TextEncoder 产出的 Uint8Array 分属不同 realm,
// 导致 `new TextEncoder().encode('') instanceof Uint8Array` 为 false,esbuild 启动自检直接抛错
// (@umijs/max 一被 import 就触发)。在 jsdom global 上用 Node 版覆盖 TextEncoder/TextDecoder,
// 并把 Node 的 Uint8Array/ArrayBuffer 一并注入,统一 realm,让自检通过。
class CustomJSDOMEnvironment extends JSDOMEnvironment {
  constructor(config, context) {
    super(config, context);
    this.global.TextEncoder = TextEncoder;
    this.global.TextDecoder = TextDecoder;
    this.global.Uint8Array = Uint8Array;
    this.global.ArrayBuffer = ArrayBuffer;
  }
}

module.exports = CustomJSDOMEnvironment;
