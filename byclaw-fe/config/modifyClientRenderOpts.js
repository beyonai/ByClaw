export const modifyClientRenderOpts = ctx => {
  ctx.basename = window.routerBase;
  const h = ctx.history;
  const originPush = h.push;
  const originReplace = h.replace;
  const getRealUrl = url => {
    if (url.indexOf('http') === 0 || url.indexOf(window.routerBase) === 0) return url;
    let res = url;
    if (res.charAt(0) === '/') {
      res = url.substring(1);
    }
    res = window.routerBase + res;
    return res;
  }
  h.push = (...args) => {
    let oriTarget = args[0];
    if (typeof oriTarget === 'string') {
      originPush.apply(h, [getRealUrl(oriTarget)].concat(args.slice(1)));
    } else {
      const { pathname } = oriTarget;
      originPush.apply(h, [{ ...oriTarget, pathname: getRealUrl(pathname) }]);
    }
  }
  h.replace = (...args) => {
    let oriTarget = args[0];
    if (typeof oriTarget === 'string') {
      originReplace.apply(h, [getRealUrl(oriTarget)].concat(args.slice(1)));
    } else {
      const { pathname } = oriTarget;
      originReplace.apply(h, [{ ...oriTarget, pathname: getRealUrl(pathname) }]);
    }
  }
  return ctx;
}