import { createAdapter } from './_core.mjs';
const adapter = createAdapter({ id: 'bycli', kinds: ['skill', 'mcp'], domains: ['byclaw.com'] });
export const source = adapter.source;
export const search = adapter.search;
export const normalize = adapter.normalize;
