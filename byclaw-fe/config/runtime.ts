import { IApi } from '@umijs/max';
import { writeFileSync, readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import routesConf from './route.config';

function getAllRoutePaths(routes: any, set = new Set<string>()) {
  routes.forEach(route => {
    const { path, component } = route;
    if (path && component) {
      set.add(path);
    }
    if (route.routes) {
      getAllRoutePaths(route.routes, set);
    }
  })
  return Array.from(set);
}

function getHtml(title: string, routePaths: string[], umiFile: { css: string, js: string }) {
  const regPrefixes = `(${routePaths.join('|')})/?$`.replace(/\//g, '\\/')
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, user-scalable=no, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="ie=edge">
<title>${title}</title>
<script>
  var pathname=window.location.pathname;
  var publicPath="/";
  if(pathname!=="/"){
    publicPath=pathname.replace(/${regPrefixes}/g,"")+"/";
    publicPath+=publicPath.slice(-1)!=="/"?"/":"";
  }
  window.publicPath=publicPath;
  window.routerBase=publicPath;
  var link=document.createElement("link");
  link.rel="shortcut icon";
  link.href=publicPath+"favicon.ico";
  document.head.appendChild(link);
</script>
</head>
<body>
<div id="root"></div>
<script>
  var link=document.createElement("link");
  link.rel="stylesheet";
  link.href=window.publicPath+"${umiFile.css}";
  document.head.appendChild(link);
  const script=document.createElement("script");
  script.src=window.publicPath+"${umiFile.js}";
  document.head.appendChild(script);
</script>
</body>
</html>
`
}

export default (api: IApi) => {
  const { title } = api.userConfig;
  const distPath = api.paths.absOutputPath;

  api.addRuntimePlugin(() => ['@@/core/basenameRuntime.ts']);

  api.onGenerateFiles(() => {
    api.writeTmpFile({
      noPluginDir: true,
      path: 'core/basenameRuntime.ts',
      content: readFileSync(join(api.cwd, 'config/modifyClientRenderOpts.js'), 'utf8'),
    })
  });

  const routePrefixes = getAllRoutePaths(routesConf);

  const getUmiFile = () => {
    const files = readdirSync(distPath);
    const result = {
      css: 'umi.css',
      js: 'umi.js',
    };
    files.forEach(fileName => {
      const match = fileName.match(/umi.*\.(js|css)$/)
      if (match) {
        result[match[1]] = fileName;
      }
    })
    return result;
  }

  const loopHtmls = (dir: string, html: string) => {
    const htmlPath = join(dir, 'index.html');
    if (existsSync(htmlPath)) {
      writeFileSync(htmlPath, html);
    }
    const files = readdirSync(dir);
    files.forEach(subDir => {
      const subPath = join(dir, subDir);
      if (statSync(subPath).isDirectory()) {
        loopHtmls(subPath, html);
      }
    })
  }

  api.onBuildHtmlComplete(() => {
    const umiFile = getUmiFile();
    const html = getHtml(title, routePrefixes, umiFile);
    loopHtmls(distPath, html);
  });
}
