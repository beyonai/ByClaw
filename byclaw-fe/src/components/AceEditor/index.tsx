import { getPublicPath } from '@/utils';
import { loadJS } from '@/utils/loadJS';
import React, { useRef, useState } from 'react';

export function getModule(jsurl: string[], reset: boolean = false) {
  let isLoaded = null;

  if (isLoaded && !reset) {
    return isLoaded;
  }

  const posts = jsurl.map(loadJS);

  return new Promise((resolve, reject) => {
    Promise.all(posts)
      .then((res) => {
        isLoaded = res;
        resolve(res);
      })
      .catch(reject);
  });
}

const loadModule = () => {
  let status = 'uninit';
  let data: any = null;
  let promise: any = null;

  return (mode: string, theme: string) => {
    switch (status) {
      // 初始状态，发出请求并抛出 promise
      case 'uninit': {
        const p = new Promise(async (resolve) => {
          const reactAce = await import('@/components/AceEditor/main.js');
          window.ace?.config?.set('basePath', getPublicPath());

          await getModule([
            `js/aceBuilds/mode/mode-text.js`,
            `js/aceBuilds/mode/mode-python.js`,
            `js/aceBuilds/mode/mode-sql.js`,
            `js/aceBuilds/theme/theme-${theme}.js`,
          ]);

          status = 'resolved';
          data = reactAce.default;

          resolve(reactAce.default);
        });

        status = 'loading';
        promise = p;
        throw promise;
      }
      // 加载状态，直接抛出 promise
      case 'loading':
        throw promise;
      // 如果加载完成直接返回数据
      case 'resolved':
        return data;
      default:
        break;
    }
  };
};

const moduleLoader = loadModule();

const AceEditorComp = (props: any) => {
  const {
    formatValue = '',
    readOnly = true,
    onChange,
    mode = 'sql',
    theme = 'sqlserver',
  } = props;

  const AceEditor = moduleLoader(mode, theme);

  const compId = useRef(`sqlFormatter_${new Date().getTime()}`);

  const [value, setValue] = useState(() => {
    if (typeof formatValue === 'string') return formatValue;

    if (typeof formatValue === 'object') {
      try {
        return JSON.stringify(formatValue, null, 2);
      } catch (e) {
        return '';
      }
    }

    return '';
  });

  return (
    <AceEditor
      mode={mode}
      width="100%"
      height="100%"
      value={value}
      theme={theme}
      name={`${compId.current}_AceEditor`}
      editorProps={{ $blockScrolling: true }}
      readOnly={readOnly}
      wrapEnabled={true}
      onChange={(val: string) => {
        setValue(val);
        onChange?.(val);
      }}
      setOptions={{
        enableBasicAutocompletion: false, //启用基本自动完成功能 不推荐使用
        enableLiveAutocompletion: false, //启用实时自动完成功能 （比如：智能代码提示）
        enableSnippets: true, //启用代码段
        showLineNumbers: true,
        tabSize: 2,
        wrap: true, // 换行
        autoScrollEditorIntoView: true, // 自动滚动编辑器视图
      }}
    />
  );
};

function AceEditor(props: any, ref: any) {
  return (
    <React.Suspense fallback={<div>Loading...</div>}>
      <AceEditorComp {...props} />
    </React.Suspense>
  );
}

export default AceEditor;

// https://manubb.github.io/react-ace-builds/
// Example Modes
// javascript
// java
// python
// xml
// ruby
// sass
// markdown
// mysql
// json
// html
// handlebars
// golang
// csharp
// coffee
// css

// Example Themes
// monokai
// github
// tomorrow
// kuroir
// twilight
// xcode
// textmate
// solarized dark
// solarized light
// terminal

// Example Keyboard Handlers
// vim
// emacs
