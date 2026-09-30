import { normalizeProject, resolveProjectScopeId } from '../utils';
import type { ProjectSpace } from '../types';

const buildProject = (overrides: Partial<ProjectSpace> = {}): ProjectSpace => ({
  projectId: '1',
  projectName: 'project',
  projectType: 'normal',
  isShare: 'N',
  sharedFlag: false,
  ...overrides,
});

describe('normalizeProject', () => {
  it('keeps the backend default project type instead of flattening it to normal', () => {
    expect(normalizeProject({ projectId: -1, projectName: '我的默认项目', projectType: 'default' }).projectType).toBe(
      'default'
    );
  });

  it('keeps develop/operation and maps the legacy development value', () => {
    expect(normalizeProject({ projectId: 2, projectType: 'develop' }).projectType).toBe('develop');
    expect(normalizeProject({ projectId: 3, projectType: 'operation' }).projectType).toBe('operation');
    expect(normalizeProject({ projectId: 4, projectType: 'development' }).projectType).toBe('develop');
  });

  it('falls back to normal when the field is missing (desktop local projects)', () => {
    expect(normalizeProject({ projectId: 'local-1', projectName: 'local' }).projectType).toBe('normal');
  });
});

describe('resolveProjectScopeId', () => {
  const defaultProject = buildProject({ projectId: '-1', projectName: '我的默认项目', projectType: 'default' });
  const targetProject = buildProject({ projectId: '237', projectName: 'byclaw-hacu' });

  it('returns the requested project when it is present in the list', () => {
    expect(resolveProjectScopeId({ projects: [defaultProject, targetProject], requestedId: '237' })).toBe('237');
  });

  it('matches numeric and string project ids', () => {
    expect(resolveProjectScopeId({ projects: [defaultProject, targetProject], requestedId: 237 })).toBe('237');
  });

  it('does not fall back to the first list item when the requested project is missing from the page', () => {
    // 目标项目在第 2 页时列表里查不到：必须返回 undefined（由调用方补齐），
    // 否则会静默把用户选择覆盖成列表第一项（系统默认项目）。
    expect(resolveProjectScopeId({ projects: [defaultProject, targetProject], requestedId: '999' })).toBeUndefined();
  });

  it('falls back to the default project when nothing is selected', () => {
    // 列表第一项刻意放成非默认项目，证明兜底用的是 projectType === 'default' 而不是 projects[0]。
    const normalProject = buildProject({ projectId: '10', projectName: '普通项目' });
    expect(resolveProjectScopeId({ projects: [normalProject, defaultProject] })).toBe('-1');
  });

  it('falls back to the first item only when no default project exists', () => {
    const normalProject = buildProject({ projectId: '10', projectName: '普通项目' });
    expect(resolveProjectScopeId({ projects: [normalProject, targetProject] })).toBe('10');
  });

  it('returns undefined for an empty list', () => {
    expect(resolveProjectScopeId({ projects: [] })).toBeUndefined();
  });
});
