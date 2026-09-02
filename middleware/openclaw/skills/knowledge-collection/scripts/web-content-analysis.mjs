'use strict';

const STRONG_CHALLENGE_MARKER = /(?:验证码|安全验证|环境验证|访问过于频繁|captcha|verify\s+you)/i;
const LOGIN_MARKER = /(?:登录|log\s*in|sign\s*in)/i;
const MAX_LOGIN_PAGE_CHARS = 800;
const ERROR_MARKER = /(?:404\s+not\s+found|500\s+internal\s+server\s+error|页面不存在|内容已删除)/i;
const NAVIGATION_MARKER = /(?:首页\s*[|｜>]\s*新闻|网站导航|全部频道|热门推荐\s+更多)/i;
const REMOTE_IMAGE = /!\[([^\]]*)\]\(\s*((?:https?:\/\/|\/\/|\/)[^)\s]+)(?:\s+['"][^'"]*['"])?\s*\)/gi;
const LOCAL_IMAGE = /!\[([^\]]*)\]\(\s*([^):\s][^)]*?)\s*\)/gi;

function paragraphCount(markdown) {
  return markdown.split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph && !/^#{1,6}\s/.test(paragraph) && !/^!\[/.test(paragraph))
    .filter((paragraph) => paragraph.replace(/\s+/g, '').length >= 15)
    .length;
}

function isChallengePage(title, markdown) {
  if (STRONG_CHALLENGE_MARKER.test(`${title}\n${markdown}`)) return true;
  if (LOGIN_MARKER.test(title)) return true;
  return markdown.trim().length <= MAX_LOGIN_PAGE_CHARS && LOGIN_MARKER.test(markdown);
}

export function analyzeWebMarkdown(markdown, executorResult = {}) {
  if (typeof markdown !== 'string') throw new TypeError('网页 Markdown 必须是字符串');
  const input = markdown.replace(/\r\n?/g, '\n');
  let remoteMediaRemoved = 0;
  const withoutRemote = input.replace(REMOTE_IMAGE, () => {
    remoteMediaRemoved += 1;
    return '';
  });
  const localAssets = [];
  for (const match of withoutRemote.matchAll(LOCAL_IMAGE)) {
    const target = match[2].trim().replace(/^<|>$/g, '');
    if (target && !target.startsWith('#')) localAssets.push(target);
  }
  const normalized = `${withoutRemote.replace(/\n{3,}/g, '\n\n').trim()}\n`;
  const title = typeof executorResult.title === 'string' ? executorResult.title.trim() : '';
  const hasChallenge = isChallengePage(title, input);
  const hasError = ERROR_MARKER.test(input);
  const hasNavigation = NAVIGATION_MARKER.test(input);
  const substantiveParagraphs = paragraphCount(normalized);
  const confidence = title && !hasChallenge && !hasError && !hasNavigation
    && substantiveParagraphs >= 5 ? 'high' : 'low';
  return {
    markdown: normalized,
    title,
    confidence,
    reasonCodes: confidence === 'high' ? ['complete-web-article-structure'] : [
      ...(!title ? ['missing-title'] : []),
      ...(hasChallenge ? ['challenge-or-login-marker'] : []),
      ...(hasError ? ['error-page-marker'] : []),
      ...(hasNavigation ? ['navigation-page-marker'] : []),
      ...(substantiveParagraphs < 5 ? ['insufficient-body-paragraphs'] : []),
    ],
    inputChars: input.length,
    outputChars: normalized.length,
    substantiveParagraphs,
    remoteMediaRemoved,
    localAssets: [...new Set(localAssets)],
  };
}
