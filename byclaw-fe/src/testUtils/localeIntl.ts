import enUS from '@/locales/en-US';
import zhCN from '@/locales/zh-CN';

type Locale = 'zh-CN' | 'en-US';

// 用真实语言包替代回显 ID 的 mock，并保留本组文案使用的命名参数插值。
// 同一语言复用 intl 对象，避免依赖 intl 的请求回调在每次 render 时重新创建。
const createLocaleIntl = (messages: Record<string, string>) => ({
  formatMessage: (
    { id, defaultMessage }: { id: string; defaultMessage?: string },
    values: Record<string, string | number> = {}
  ) => (messages[id] || defaultMessage || id).replace(/\{(\w+)\}/g, (match, key) => String(values[key] ?? match)),
});
const locales = { 'zh-CN': createLocaleIntl(zhCN), 'en-US': createLocaleIntl(enUS) };

export const getLocaleIntl = (locale: Locale = 'zh-CN') => locales[locale];
