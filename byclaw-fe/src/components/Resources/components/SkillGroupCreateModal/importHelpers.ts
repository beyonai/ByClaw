import type { ResourceImportResult } from '@/pages/manager/service/resources';

export const getSuccessfulImportedSkillIds = (result?: ResourceImportResult): string[] => {
  const items = [...(result?.items ?? []), ...(result?.createdItems ?? []), ...(result?.updatedItems ?? [])];

  return Array.from(
    new Set(
      items
        .filter((item) => item.success === true && item.resourceId !== undefined && item.resourceId !== null)
        .map((item) => String(item.resourceId))
        .filter((resourceId) => resourceId.trim().length > 0)
    )
  );
};

export const mergeSelectedSkillIds = (currentIds: string[] = [], importedIds: string[] = []): string[] =>
  Array.from(new Set([...currentIds, ...importedIds].map((id) => String(id))));
