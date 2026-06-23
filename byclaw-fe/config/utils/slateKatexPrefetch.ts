import fs from 'fs';
import path from 'path';

const slateKatexAssetRegExp = /^etag\.slate-katex\.[a-f0-9]{8,}\.js$/;

function normalizePublicPath(publicPath: string | undefined) {
  if (!publicPath || publicPath === 'auto') {
    return '';
  }
  return publicPath.endsWith('/') ? publicPath : `${publicPath}/`;
}

function walkHtmlFiles(dir: string, files: string[] = []) {
  if (!fs.existsSync(dir)) {
    return files;
  }

  fs.readdirSync(dir).forEach((fileName) => {
    const filePath = path.join(dir, fileName);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      walkHtmlFiles(filePath, files);
      return;
    }

    if (fileName.endsWith('.html')) {
      files.push(filePath);
    }
  });

  return files;
}

export function getSlateKatexAssetName(distPath: string) {
  if (!fs.existsSync(distPath)) {
    return undefined;
  }

  return fs.readdirSync(distPath).find((fileName) => slateKatexAssetRegExp.test(fileName));
}

export function injectSlateKatexPrefetch(html: string, href: string) {
  if (html.includes(`href="${href}"`) || !html.includes('</head>')) {
    return html;
  }

  return html.replace('</head>', `<link href="${href}" rel="prefetch">\n</head>`);
}

export function injectSlateKatexPrefetchToHtmlFiles(distPath: string, publicPath?: string) {
  const assetName = getSlateKatexAssetName(distPath);
  if (!assetName) {
    return [];
  }

  const href = `${normalizePublicPath(publicPath)}${assetName}`;
  const changedFiles: string[] = [];

  walkHtmlFiles(distPath).forEach((htmlPath) => {
    const html = fs.readFileSync(htmlPath, 'utf8');
    const nextHtml = injectSlateKatexPrefetch(html, href);

    if (nextHtml !== html) {
      fs.writeFileSync(htmlPath, nextHtml);
      changedFiles.push(htmlPath);
    }
  });

  return changedFiles;
}
