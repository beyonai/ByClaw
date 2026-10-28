/** Keep useful details in the selected language and hide raw errors from another language. */
export const localizeErrorMessage = (message: unknown, fallback: string, locale: string): string => {
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text) return fallback;
  const language = locale.toLowerCase();
  const hasChinese = /\p{Script=Han}/u.test(text);
  const hasEnglish = /[A-Za-z]{3,}/.test(text);
  const hasEnglishTechnicalDetail = /[:：]\s*[A-Za-z]{3,}/.test(text);
  if (
    (language.startsWith('zh') && hasEnglish && (!hasChinese || hasEnglishTechnicalDetail)) ||
    (language.startsWith('en') && hasChinese)
  ) {
    return fallback;
  }
  return text;
};
