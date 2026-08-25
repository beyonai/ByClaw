import { getProjectResourceCategoryCount, supportsProjectRepositories } from '../projectCapabilities';

describe('project capabilities', () => {
  it('enables shared repositories for development and operation projects', () => {
    expect(supportsProjectRepositories('develop')).toBe(true);
    expect(supportsProjectRepositories('operation')).toBe(true);
    expect(supportsProjectRepositories('normal')).toBe(false);
    expect(supportsProjectRepositories('default')).toBe(false);
  });

  it('includes the shared repository card in operation project resources', () => {
    expect(getProjectResourceCategoryCount('develop')).toBe(2);
    expect(getProjectResourceCategoryCount('operation')).toBe(5);
    expect(getProjectResourceCategoryCount('normal')).toBe(1);
  });
});
