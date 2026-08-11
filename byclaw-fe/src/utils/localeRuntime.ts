import { addLocale } from '@@/plugin-locale';

export const mergeLocaleMessages = (locale: string, messages: Record<string, string>) => {
  addLocale(locale, messages, {} as Parameters<typeof addLocale>[2]);
};
