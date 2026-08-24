import type { ResourceImportItem, ResourceImportResult } from '@/pages/manager/service/resources';
import { getSuccessfulImportedSkillIds, mergeSelectedSkillIds } from '../importHelpers';

const createImportItem = (resourceId: ResourceImportItem['resourceId'], success = true): ResourceImportItem => ({
  resourceCode: String(resourceId ?? 'missing'),
  resourceName: String(resourceId ?? 'missing'),
  resourceId,
  updated: false,
  success,
});

const createImportResult = (overrides: Partial<ResourceImportResult> = {}): ResourceImportResult => ({
  total: 0,
  success: 0,
  failed: 0,
  ...overrides,
});

describe('getSuccessfulImportedSkillIds', () => {
  it('collects successful IDs from canonical and summary collections in order', () => {
    const numericId = 2 as unknown as string;
    const result = createImportResult({
      items: [createImportItem('skill-1')],
      createdItems: [createImportItem(numericId)],
      updatedItems: [createImportItem('skill-3')],
    });

    expect(getSuccessfulImportedSkillIds(result)).toEqual(['skill-1', '2', 'skill-3']);
  });

  it('excludes failed items and successful items without IDs', () => {
    const result = createImportResult({
      items: [
        createImportItem('failed-skill', false),
        createImportItem(undefined),
        createImportItem(null as unknown as string),
        createImportItem(''),
        createImportItem('   '),
      ],
    });

    expect(getSuccessfulImportedSkillIds(result)).toEqual([]);
  });

  it('returns an empty list when the result is absent or every import failed', () => {
    expect(getSuccessfulImportedSkillIds()).toEqual([]);
    expect(
      getSuccessfulImportedSkillIds(
        createImportResult({
          items: [createImportItem('failed-skill', false)],
        })
      )
    ).toEqual([]);
  });

  it('removes duplicate IDs while preserving their first-seen order', () => {
    const result = createImportResult({
      items: [createImportItem('skill-2'), createImportItem('skill-1')],
      createdItems: [createImportItem('skill-2')],
      updatedItems: [createImportItem('skill-1'), createImportItem('skill-3')],
    });

    expect(getSuccessfulImportedSkillIds(result)).toEqual(['skill-2', 'skill-1', 'skill-3']);
  });
});

describe('mergeSelectedSkillIds', () => {
  it('preserves existing selection order and appends only new imported IDs', () => {
    const numericId = 3 as unknown as string;

    expect(mergeSelectedSkillIds(['skill-2', 'skill-1', 'skill-2'], ['skill-1', numericId, 'skill-4'])).toEqual([
      'skill-2',
      'skill-1',
      '3',
      'skill-4',
    ]);
    expect(mergeSelectedSkillIds()).toEqual([]);
  });
});
