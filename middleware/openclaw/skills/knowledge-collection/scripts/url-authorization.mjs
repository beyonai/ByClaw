'use strict';

import { getDomain } from 'tldts';

const MAX_DIAGNOSTIC_URL_CHARS = 2_000;
const SENSITIVE_QUERY_KEY = /(?:^|[_-])(?:access-token|access_token|auth|authorization|code|cookie|credential|key|password|secret|session|sig|signature|token)(?:$|[_-])/iu;

function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} 必须是非空字符串`);
  }
  return value.trim();
}

export function normalizeAuthorizationUrl(rawUrl, label = 'URL') {
  let url;
  try {
    url = new URL(requireText(rawUrl, label));
  } catch {
    throw new Error(`${label} 必须是有效 HTTP URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${label} 必须是安全 HTTP URL`);
  }
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  url.searchParams.sort();
  return url.toString();
}

function comparableUrl(rawUrl, label) {
  const url = new URL(normalizeAuthorizationUrl(rawUrl, label));
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.toString();
}

export function authorizationEquivalentHttpUrl(left, right) {
  return comparableUrl(left, 'authorized URL') === comparableUrl(right, 'resolved URL');
}

function registrableDomain(url) {
  return getDomain(url.hostname, { allowPrivateDomains: true });
}

export function authorizationAllowsHttpRedirect(requestedUrl, resolvedUrl, authorizedUrls = []) {
  const requested = new URL(normalizeAuthorizationUrl(requestedUrl, 'requested URL'));
  const resolved = new URL(normalizeAuthorizationUrl(resolvedUrl, 'resolved URL'));
  if (requested.protocol === 'https:' && resolved.protocol !== 'https:') return false;
  if (authorizedUrls.some((url) => authorizationEquivalentHttpUrl(url, resolved.toString()))) return true;
  if (requested.port !== resolved.port) return false;
  if (requested.hostname === 'weixin.sogou.com' && requested.pathname === '/link'
    && resolved.hostname === 'mp.weixin.qq.com' && /^\/s(?:\/|$)/u.test(resolved.pathname)) {
    return true;
  }
  const requestedDomain = registrableDomain(requested);
  return Boolean(requestedDomain && requestedDomain === registrableDomain(resolved));
}

export function diagnosticHttpUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null;
  try {
    const url = new URL(rawUrl.trim());
    url.username = '';
    url.password = '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEY.test(key)) url.searchParams.set(key, '[REDACTED]');
    }
    return [...url.toString()].slice(0, MAX_DIAGNOSTIC_URL_CHARS).join('');
  } catch {
    const redacted = rawUrl
      .replace(/\/\/[^/@\s]+@/gu, '//[REDACTED]@')
      .replace(/(^|[?&;\s])([^=?&#;\s]+)=((?:Bearer\s+)?(?:"[^"]*"|'[^']*'|[^&#;\s]*))/giu,
        (match, prefix, key) => (
        SENSITIVE_QUERY_KEY.test(key) ? `${prefix}${key}=[REDACTED]` : match
        ));
    return [...redacted]
      .slice(0, MAX_DIAGNOSTIC_URL_CHARS).join('');
  }
}
