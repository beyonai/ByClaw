import { getLocale } from '@umijs/max';

export function isEnglishEnv() {
  const lang = getLocale();
  return lang.indexOf('en') > -1;
}
