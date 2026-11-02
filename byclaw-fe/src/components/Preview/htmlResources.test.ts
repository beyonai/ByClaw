import { resolveHtmlResources } from './htmlResources';

const blob = (source: string) => Object.assign(new Blob([source]), { text: async () => source });
let blobs: Blob[];
beforeEach(() => {
  blobs = [];
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: jest.fn((value) => {
      blobs.push(value);
      return `blob:resource-${blobs.length}`;
    }),
  });
});

it('resolves stylesheets, nested CSS imports, fonts, images, posters and source sets against the owning file', async () => {
  const resources: Record<string, Blob> = {
    '../css/main.css': blob('@import "./theme.css"; body { background:url(../images/bg.png) }'),
    '../css/theme.css': blob('@font-face {src:url(../fonts/a.woff2)}'),
    '../images/bg.png': blob('image'),
    '../fonts/a.woff2': blob('font'),
    'cover.png': blob('cover'),
    'small.png': blob('small'),
    'large.png': blob('large'),
  };
  const resolver = jest.fn(async (path: string) => {
    if (!resources[path]) throw new Error(path);
    return resources[path];
  });
  const result = await resolveHtmlResources(
    '<link rel="stylesheet" href="../css/main.css"><video poster="cover.png"></video><img srcset="small.png 1x, large.png 2x">',
    resolver
  );
  expect(result.failed).toEqual([]);
  expect(resolver).toHaveBeenCalledWith('../css/theme.css');
  expect(resolver).toHaveBeenCalledWith('../fonts/a.woff2');
  expect(result.content).not.toContain('href="../css/main.css"');
  expect(result.content).toContain('blob:resource-');
  const css = await Promise.all(
    blobs
      .filter((value) => value.type === 'text/css')
      .map(
        (value) =>
          new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.readAsText(value);
          })
      )
  );
  expect(css.join('\n')).not.toContain('../fonts/');
  expect(css.join('\n')).not.toContain('../images/');
});

it('reports failed assets while keeping the rest of the HTML and external URLs', async () => {
  const result = await resolveHtmlResources(
    '<p>正文</p><img src="missing.png"><img src="https://example.com/a.png">',
    async () => {
      throw new Error('404');
    }
  );
  expect(result.failed).toEqual(['missing.png']);
  expect(result.content).toContain('正文');
  expect(result.content).toContain('https://example.com/a.png');
});

jest.mock('es-module-lexer/js', () => jest.requireActual('es-module-lexer'));
beforeAll(async () => {
  await (
    await import('es-module-lexer')
  ).init;
});

it('uses the real module lexer for imports without rewriting strings or bare modules', async () => {
  const resources: Record<string, Blob> = {
    'js/main.js': blob(
      'import { x } from "./dep.js"; export { x } from "./dep.js"; import("./lazy.js"); import "react"; const sample = "import(\'./not-a-resource.js\')";'
    ),
    'js/dep.js': blob('export const x = 1;'),
    'js/lazy.js': blob('export default 2;'),
  };
  const resolver = jest.fn(async (path: string) => {
    if (!resources[path]) throw new Error(path);
    return resources[path];
  });
  const result = await resolveHtmlResources('<script type="module" src="js/main.js"></script>', resolver);
  expect(result.failed).toEqual([]);
  expect(resolver).toHaveBeenCalledWith('js/dep.js');
  expect(resolver).toHaveBeenCalledWith('js/lazy.js');
  expect(resolver).not.toHaveBeenCalledWith('js/not-a-resource.js');
  expect(resolver).not.toHaveBeenCalledWith('react');
});

it('terminates cyclic stylesheet imports with a resource warning', async () => {
  const resources: Record<string, Blob> = {
    'a.css': blob('@import "b.css";'),
    'b.css': blob('@import "a.css";'),
  };
  const result = await resolveHtmlResources(
    '<link rel="stylesheet" href="a.css"><link rel="stylesheet" href="b.css">',
    async (path) => resources[path]
  );
  expect(result.failed.sort()).toEqual(['a.css', 'b.css']);
});

it('resolves unquoted CSS imports recursively and preserves their media condition', async () => {
  const resources: Record<string, Blob> = {
    'css/main.css': blob('@import url(./theme.css) screen;'),
    'css/theme.css': blob('.probe {background:url(../images/check.svg)}'),
    'images/check.svg': blob('<svg/>'),
  };
  const resolver = jest.fn(async (path: string) => resources[path]);
  const result = await resolveHtmlResources('<link rel="stylesheet" href="css/main.css">', resolver);
  expect(result.failed).toEqual([]);
  expect(resolver).toHaveBeenCalledWith('css/theme.css');
  expect(resolver).toHaveBeenCalledWith('images/check.svg');
  const styles = await Promise.all(
    blobs
      .filter((value) => value.type === 'text/css')
      .map(
        (value) =>
          new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.readAsText(value);
          })
      )
  );
  expect(styles.join('\n')).toContain(') screen;');
  expect(styles.join('\n')).not.toContain('../images/');
});

it('rewrites inline module imports without changing inline classic scripts or JSON data', async () => {
  const resources: Record<string, Blob> = {
    './js/dep.js': blob('export const value = 1;'),
    './js/lazy.js': blob('export default 2;'),
  };
  const resolver = jest.fn(async (path: string) => resources[path]);
  const classic = 'window.example="./js/classic.js";';
  const json = '{"path":"./js/data.js"}';
  const result = await resolveHtmlResources(
    `<script type="module">import {value} from './js/dep.js'; import('./js/lazy.js');</script><script>${classic}</script><script type="application/ld+json">${json}</script>`,
    resolver
  );
  expect(result.failed).toEqual([]);
  expect(resolver).toHaveBeenCalledWith('./js/dep.js');
  expect(resolver).toHaveBeenCalledWith('./js/lazy.js');
  expect(result.content).not.toContain("from './js/dep.js'");
  expect(result.content).toContain(classic);
  expect(result.content).toContain(json);
});
