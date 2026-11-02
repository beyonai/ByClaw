import { createAdapter } from './_core.mjs';
const adapter = createAdapter({ id: 'clawhub', kinds: ['skill'], domains: ['clawhub.ai'], clawhub: true });
export const source = adapter.source;
export const search = adapter.search;
export const normalize = adapter.normalize;
