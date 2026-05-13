import { defineConfig } from '@umijs/max';
import { set } from 'lodash';
import path from 'path';
import routes from './config/route.config';
import getUmiConfig from './config/getUmiConfig';
import { loadMonorepoEnvForUmi } from './config/loadMonorepoEnvForUmi';

const getArgvOptions = require('./config/getArgvOptions');
const argvOptions = getArgvOptions();

loadMonorepoEnvForUmi();

/** 开发代理：在仓库根 .env 或 byclaw-fe/.env 中配置，避免改 .umirc.ts 产生冲突 */
const target = `http://${process.env.HOST}:${process.env.BE_SERVER_PORT}` || 'http://localhost:8086';

const wsTarget = process.env.BYCLAW_PORTAL_URL_WS?.trim() || 'http://localhost:8082';

const isDev = process.env.NODE_ENV === 'development';
const publicPath = argvOptions.publicPath || '/';
const base = publicPath;
const routerBase = base.endsWith('/') ? base : `${base}/`;

const PrefixName = 'beyond';

const plugins = ['umi-plugin-keep-alive', './config/plugins/iconfont-hash'];
let myDefineConfig: Record<string, any> = {
  base,
  publicPath,
};

if (argvOptions.runtime) {

  plugins.push('./config/runtime.ts');
  myDefineConfig = {
    runtimePublicPath: {},
  };
}

const cssLoader = {
  modules: {
    // localIdentName: '[folder]__[name]__[local]--[hash:base64:5]',
    getLocalIdent: (context: any, _: string, localName: string) => {
      if (
        context.resourcePath.includes('node_modules') ||
        context.resourcePath.includes('global.less') ||
        context.resourcePath.includes('overrides.less') ||
        context.resourcePath.includes('iconfont.css')
      ) {
        return localName;
      }
      return undefined;
    },
  },
};

if (isDev) {
  set(cssLoader, 'modules.localIdentName', '[folder]__[name]__[local]--[hash:base64:5]');
}

const umiConfig = getUmiConfig(publicPath);

export default defineConfig({
  ...myDefineConfig,
  proxy: {
    [`${routerBase}byaiService/ws`]: {
      target: wsTarget,
      changeOrigin: true,
      ws: true,
    },
    [`${routerBase}byaiService`]: {
      target,
      changeOrigin: true,
    },
  },
  chainWebpack(config: any) {
    // 关键修复：强制设置模块解析条件顺序
    config.resolve.conditionNames = ['import', 'node', 'default'];

    // 配置 splitChunks，将 slate 和 katex 打包到同一个文件
    config.optimization.splitChunks.merge({
      cacheGroups: umiConfig.cacheGroups,
    });

    // 配置 chunk 文件名，为 slate-katex chunk 移除 hash
    if (!isDev) {
      // 获取当前的 chunkFilename 配置
      const currentChunkFilename = config.output.get('chunkFilename') || 'js/[name].[contenthash:8].js';

      config.output.chunkFilename((pathData: any) => {
        // 如果是 slate-katex chunk，不使用 hash
        if (pathData.chunk?.name && pathData.chunk?.name.startsWith('etag.')) {
          return '[name].js';
        }
        // 其他 chunk 保持原有命名规则（带 hash）
        // 如果原有配置是函数，调用它；否则使用默认格式
        if (typeof currentChunkFilename === 'function') {
          return currentChunkFilename(pathData);
        }
        return currentChunkFilename;
      });
    }
  },
  links: umiConfig.links,
  locale: {
    default: 'zh-CN', // 国际化默认英文
    // default: 'en-US',
    antd: true,
    // default true, when it is true, will use `navigator.language` overwrite default
    baseNavigator: false,
    useLocalStorage: true,
  },
  define: {
    ...umiConfig.define,
    _PUBLIC_PATH_: publicPath,
    PREFIX_NAME: PrefixName,
    BI_CLOUD: '',
    THEME: '',
    BUILD_TIME: new Date().getTime(),
    'process.env.REACT_APP_REQ_PREFIX': '/api',
    URI_TARGET: target,
  },
  exportStatic: {},
  plugins,
  lessLoader: {
    modifyVars: {
      antPrefix: PrefixName,
      'ant-prefix': PrefixName,
    },
    javascriptEnabled: true,
  },
  cssLoader,
  routes,
  antd: {},
  dva: {},
  alias: {
    '@': path.join(__dirname, 'src'),
    '@beyond': path.join(__dirname, 'src'),
  },
  npmClient: 'npm',
  title: '鲸智百应',
  historyWithQuery: {},
  headScripts: [`window.publicPath="${publicPath}";window.routerBase="${base}";`],
  targets: {
    chrome: 67,
    safari: 12,
  },
  // legacy: {},
  esbuildMinifyIIFE: true,
  metas: [
    { 'http-equiv': 'Pragma', content: 'no-cache' },
    {
      'http-equiv': 'Cache-Control',
      content: 'no-cache, no-store, must-revalidate',
    },
    { 'http-equiv': 'Expires', content: '0' },
    { name: 'keywords', content: '鲸智百应, 下载, APP, 智能助手, 办公助手, AI应用, 微信扫码, 超级助手' },
    {
      name: 'description',
      content:
        '鲸智百应是一款企业级AI操作系统，致力于为企业中的每一位员工量身打造“一呼百应” 的超级助手，助力员工摆脱繁琐事务的羁绊，使其得以全身心聚焦于分析、改进、决策等价值创造工作，进而突破个体工作效率的既有上限；具备自然语言交互、低侵入集成、自我进化以及安全可靠等特性，面向垂直领域与专业岗位提供低成本的高效赋能，切实满足不同业务场景下的多样化需求。鲸智百应精心构建的 “1 + 1 + N” 新型智能协作网络，全面覆盖了人，数字员工，数据、知识以及功能等生产要素，不仅重新定义了组织的工作方式，也塑造了 “生产提效、管理可控、持续成长” 的生产力优化闭环，助推企业的高效运营与持续发展。',
    },
    { property: 'og:title', content: '鲸智百应' },
    {
      property: 'og:description',
      content:
        '鲸智百应是一款企业级AI操作系统，致力于为企业中的每一位员工量身打造“一呼百应” 的超级助手，助力员工摆脱繁琐事务的羁绊，使其得以全身心聚焦于分析、改进、决策等价值创造工作，进而突破个体工作效率的既有上限；具备自然语言交互、低侵入集成、自我进化以及安全可靠等特性，面向垂直领域与专业岗位提供低成本的高效赋能，切实满足不同业务场景下的多样化需求。鲸智百应精心构建的 “1 + 1 + N” 新型智能协作网络，全面覆盖了人，数字员工，数据、知识以及功能等生产要素，不仅重新定义了组织的工作方式，也塑造了 “生产提效、管理可控、持续成长” 的生产力优化闭环，助推企业的高效运营与持续发展。',
    },
    { property: 'og:image', content: 'https://www.iwhaleai.com/beyond/favicon.svg.png' },
    { property: 'og:url', content: 'https://www.iwhaleai.com' },
    { property: 'og:type', content: 'website' },
  ],
  hash: true,
  mfsu: false, // 设置为 false
});
