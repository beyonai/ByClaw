import { getProjectResourceCategoryCount, supportsProjectRepositories } from '../projectCapabilities';

describe('project capabilities', () => {
  it('uses the same project capabilities for every project', () => {
    expect(supportsProjectRepositories('develop')).toBe(true);
    expect(supportsProjectRepositories('operation')).toBe(true);
    expect(supportsProjectRepositories('normal')).toBe(true);
    expect(supportsProjectRepositories('default')).toBe(true);
  });

  it('uses the same resource layout for every project', () => {
    expect(getProjectResourceCategoryCount('develop')).toBe(2);
    expect(getProjectResourceCategoryCount('operation')).toBe(2);
    expect(getProjectResourceCategoryCount('normal')).toBe(2);
  });
});
