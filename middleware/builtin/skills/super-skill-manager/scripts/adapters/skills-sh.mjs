import { createAdapter } from './_core.mjs';
const adapter = createAdapter({ id: 'skills-sh', kinds: ['skill'], domains: ['skills.sh'] });
export const source = adapter.source;
export const search = adapter.search;
export const normalize = adapter.normalize;
