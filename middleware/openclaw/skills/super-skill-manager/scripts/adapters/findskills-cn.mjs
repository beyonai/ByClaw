import { createAdapter } from './_core.mjs';
const adapter = createAdapter({ id: 'findskills-cn', kinds: ['skill'], domains: ['findskills.cn'] });
export const source = adapter.source;
export const search = adapter.search;
export const normalize = adapter.normalize;
