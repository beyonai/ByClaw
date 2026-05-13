function parse(search: string) {
  let str = search;
  if (str.indexOf('?') === 0 || str.indexOf('#') === 0) {
    str = search.substring(1);
  }
  const query: any = {};
  if (!str) return query;
  const params = str.split('&');
  params.forEach((param) => {
    const firstEqualIdx = param.split('').findIndex((str) => str === '=');
    if (firstEqualIdx <= 0) return;

    const key = param.substring(0, firstEqualIdx);
    const value = param.substring(firstEqualIdx + 1);

    query[key] = decodeURIComponent(value);
  });
  return query;
}

function stringify(obj: any) {
  return Object.entries(obj).reduce((str, [k, v]) => `${str}${str ? '&' : ''}${k}=${v}`, '');
}

export { parse, stringify };
