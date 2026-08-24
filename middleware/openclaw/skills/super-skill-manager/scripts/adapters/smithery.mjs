import { createAdapter } from './_core.mjs';
const adapter = createAdapter({ id: 'smithery', kinds: ['skill', 'mcp'], domains: ['smithery.ai'] });
export const source = adapter.source;
export const search = adapter.search;
export const normalize = adapter.normalize;
