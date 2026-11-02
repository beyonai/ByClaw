import { createRequire } from 'module';
import { runInNewContext } from 'vm';
import config from '../../.umirc';

jest.mock('@umijs/max', () => ({ defineConfig: (value: unknown) => value }));
jest.mock('../route.config', () => ({ __esModule: true, default: [] }));
jest.mock('../getArgvOptions', () => () => ({}));
jest.mock('../loadMonorepoEnvForUmi', () => ({ loadMonorepoEnvForUmi: jest.fn() }));
jest.mock('../buildFileRemoteProxy', () => ({ buildFileRemoteProxy: () => ({}) }));
jest.mock('../getUmiConfig', () => ({
  __esModule: true,
  default: () => ({ define: {}, links: [], cacheGroups: {} }),
}));

// 沿已安装的 Umi 依赖解析压缩器，覆盖实际使用的版本，不新增独立 Terser 依赖。
const maxRequire = createRequire(require.resolve('@umijs/max/package.json'));
const umiRequire = createRequire(maxRequire.resolve('umi/package.json'));
const TerserPlugin = umiRequire('@umijs/bundler-webpack/compiled/terser-webpack-plugin');

describe('production JavaScript minifier', () => {
  it('uses Terser without raising the existing browser targets', () => {
    expect(config.jsMinifier).toBe('terser');
    expect(config.targets).toEqual({ chrome: 67, safari: 12 });
  });

  it.each([
    ['0n', '0'],
    ['9007199254740993n + 2n', '9007199254740995'],
  ])('minifies BigInt expression %s without losing precision', async (expression, expected) => {
    // 模拟异步解码 chunk 中的 BigInt 字面量，验证压缩后的执行结果而非输出字符串格式。
    const result = await TerserPlugin[`${config.jsMinifier}Minify`](
      { 'decoder.async.js': `globalThis.result = (${expression}).toString();` },
      undefined,
      { format: { comments: false } }
    );

    expect(result.errors ?? []).toEqual([]);
    expect(result.code).toBeTruthy();
    const context: { result?: string } = {};
    runInNewContext(result.code, context);
    expect(context.result).toBe(expected);
  });
});
