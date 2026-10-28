import type { MarkdownImageResolver } from './Md';

const isRelative = (value: string) => value && !/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(value);
const logicalUrl = (value: string, owner: string) => {
  if (!owner) return value;
  const [pathname, ...suffix] = value.split(/(?=[?#])/);
  const parts = owner.split(/[?#]/, 1)[0].split('/').slice(0, -1);
  pathname.split('/').forEach((part) => {
    if (!part || part === '.') return;
    if (part === '..' && parts.length && parts.at(-1) !== '..') parts.pop();
    else parts.push(part);
  });
  return parts.join('/') + suffix.join('');
};
const replaceAsync = async (source: string, regex: RegExp, replace: (...args: string[]) => Promise<string>) => {
  const matches = Array.from(source.matchAll(regex));
  const values = await Promise.all(matches.map((match) => replace(...match)));
  let index = 0;
  return source.replace(regex, () => values[index++]);
};

/** 资源以原文件目录解析；Blob URL 本身不能作为 CSS/JS 的相对路径基准。 */
export async function resolveHtmlResources(content: string, resolver: MarkdownImageResolver) {
  const document = new DOMParser().parseFromString(content, 'text/html');
  const objectUrls: string[] = [];
  const failed = new Set<string>();
  const cache = new Map<string, Promise<string>>();
  const objectUrl = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    objectUrls.push(url);
    return url;
  };

  const resource = async (value: string, owner = '', kind = '', ancestry: string[] = []): Promise<string> => {
    if (!isRelative(value)) return value;
    const path = logicalUrl(value, owner);
    const key = `${kind}:${path}`;
    if (ancestry.includes(key) || ancestry.length > 12) {
      failed.add(path);
      return value;
    }
    const cached = cache.get(key);
    if (cached && !kind) return cached;
    const next = [...ancestry, key];
    const task = (async () => {
      try {
        let data = await resolver(path);
        if (kind && typeof data === 'string') {
          const response = await fetch(data, { cache: 'no-store' });
          if (!response.ok) throw new Error('Resource unavailable');
          data = await response.blob();
        }
        if (!(data instanceof Blob)) return data || value;
        if (!data.size) throw new Error('Empty resource');
        if (kind === 'css') {
          // eslint-disable-next-line @typescript-eslint/no-use-before-define
          return objectUrl(new Blob([await css(await data.text(), path, next)], { type: 'text/css' }));
        }
        if (kind === 'js') {
          // eslint-disable-next-line @typescript-eslint/no-use-before-define
          const source = await javascript(await data.text(), path, next);
          return objectUrl(new Blob([source], { type: 'text/javascript' }));
        }
        return objectUrl(data);
      } catch {
        failed.add(path);
        return value;
      }
    })();
    cache.set(key, task);
    return task;
  };

  const css = async (source: string, owner: string, ancestry: string[]) => {
    const imports = await replaceAsync(
      source,
      /@import\s+(?:url\(\s*(?:(['"])([^'"]+)\1|([^)'"\s]+))\s*\)|(['"])([^'"]+)\4)/gi,
      async (_match, _urlQuote, quotedUrl, unquotedUrl, _quote, quotedPath) =>
        `@import url("${await resource(quotedUrl || unquotedUrl || quotedPath, owner, 'css', ancestry)}")`
    );
    return replaceAsync(
      imports,
      /url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi,
      async (_match, _quote, value) => `url("${await resource(value, owner, '', ancestry)}")`
    );
  };
  const javascript = async (source: string, owner: string, ancestry: string[]) => {
    const { parse } = await import('es-module-lexer/js');
    const [imports] = parse(source);
    const replacements = await Promise.all(
      imports.map(async (item) => {
        if (!item.n?.startsWith('.')) return undefined;
        const url = await resource(item.n, owner, 'js', ancestry);
        return { start: item.s, end: item.e, value: item.d >= 0 ? JSON.stringify(url) : url };
      })
    );
    let result = source;
    replacements
      .filter((item): item is NonNullable<typeof item> => !!item)
      .sort((a, b) => b.start - a.start)
      .forEach(({ start, end, value }) => {
        result = result.slice(0, start) + value + result.slice(end);
      });
    return result;
  };

  await Promise.all(
    Array.from(
      document.querySelectorAll<HTMLElement>(
        'img[src], source[src], video[src], audio[src], track[src], video[poster], script[src], link[href], a[href]'
      )
    ).map(async (element) => {
      const attribute = element.hasAttribute('src') ? 'src' : element.hasAttribute('poster') ? 'poster' : 'href';
      const value = element.getAttribute(attribute) || '';
      if (!isRelative(value)) return;
      if (element.tagName === 'A') element.setAttribute('data-preview-resource-path', value);
      let kind = '';
      if (element.tagName === 'SCRIPT') kind = 'js';
      else if (element.tagName === 'LINK' && element.getAttribute('rel')?.toLowerCase() === 'stylesheet') kind = 'css';
      element.setAttribute(attribute, await resource(value, '', kind));
    })
  );
  await Promise.all(
    Array.from(document.querySelectorAll<HTMLElement>('style, [style], [srcset], script:not([src])')).map(
      async (element) => {
        if (element.tagName === 'SCRIPT' && element.getAttribute('type')?.toLowerCase() === 'module')
          element.textContent = await javascript(element.textContent || '', '', []);
        if (element.tagName === 'STYLE') element.textContent = await css(element.textContent || '', '', []);
        if (element.hasAttribute('style'))
          element.setAttribute('style', await css(element.getAttribute('style') || '', '', []));
        const srcset = element.getAttribute('srcset');
        if (srcset && !srcset.includes('data:')) {
          const candidates = await Promise.all(
            srcset.split(',').map(async (candidate) => {
              const [value, ...descriptor] = candidate.trim().split(/\s+/);
              return [await resource(value), ...descriptor].join(' ');
            })
          );
          element.setAttribute('srcset', candidates.join(', '));
        }
      }
    )
  );
  return { content: document.documentElement.outerHTML, objectUrls, failed: Array.from(failed) };
}
