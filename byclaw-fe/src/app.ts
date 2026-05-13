// 运行时配置
import { legacyLogicalPropertiesTransformer, StyleProvider } from '@ant-design/cssinjs';
import { App as AppAnt } from 'antd';
import React from 'react';
import { loadJS } from './utils/loadJS';
import { autoFixContext, AliveScope } from 'react-activation';
import jsxDevRuntime from 'react/jsx-dev-runtime';
import jsxRuntime from 'react/jsx-runtime';
import './utils/polyfill';
import { monitoring } from '@/utils/monitoring';
import ErrorBoundary from '@/components/ErrorBoundary';

autoFixContext([jsxRuntime, 'jsx', 'jsxs', 'jsxDEV'], [jsxDevRuntime, 'jsx', 'jsxs', 'jsxDEV']);

const Version = '3.0.1';

// 声明全局 VConsole 类型
// declare global {
//   interface Window {
//     VConsole: any;
//     g_app: any;  // Umi 应用实例
//   }
// }

// 美化控制台日志输出
const showVersion = () => {
  const buildTime = new Date(Number(BUILD_TIME)).toLocaleString();
  const styles = [
    'background: linear-gradient(45deg, #667eea 0%, #764ba2 100%)',
    'color: white',
    'padding: 8px 16px',
    'border-radius: 888px',
    'font-weight: bold',
    'font-size: 14px',
    'box-shadow: 0 4px 8px rgba(0,0,0,0.1)',
    'text-shadow: 0 1px 2px rgba(0,0,0,0.3)',
  ].join(';');
  const icon = '🚀';
  const message = `${icon} ${Version} 项目构建于 ${buildTime}`;

  console.log(`%c${message}`, styles);
};

async function init() {
  showVersion();
  monitoring.init();

  if (window.location && window.location.search && window.location.search.indexOf('vconsole=1') > -1) {
    // 使用 try-catch 确保即使加载失败也不会影响主程序
    try {
      await loadJS('js/vconsole.min.js');
      if (window.VConsole) {
        // 使用 window. 前缀避免直接引用未定义的变量
        const con = new window.VConsole();
        console.log(con.version);
      }
    } catch (e) {
      console.error('Failed to load VConsole:', e);
    }
  }

  if (process.env.NODE_ENV === 'development') {
    // eslint-disable-next-line
    require('@/mock');
  }
}

init();

export function rootContainer(container: any) {
  const appContainer = React.createElement(
    AppAnt,
    {
      style: {
        height: '100%',
        width: '100%',
      },
      prefixCls: `${PREFIX_NAME}-app`,
    },
    container
  );
  const aliveContainer = React.createElement(AliveScope, null, appContainer);
  const styledContainer = React.createElement(
    StyleProvider,
    {
      hashPriority: 'high',
      transformers: [legacyLogicalPropertiesTransformer],
    },
    aliveContainer
  );
  return React.createElement(ErrorBoundary, null, styledContainer);
}
