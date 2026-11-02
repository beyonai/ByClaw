import { createAdapter } from './_core.mjs';
const adapter = createAdapter({ id: 'github', kinds: ['skill'], domains: ['github.com'], github: true });
export const source = adapter.source;
export const search = adapter.search;
export const normalize = adapter.normalize;
