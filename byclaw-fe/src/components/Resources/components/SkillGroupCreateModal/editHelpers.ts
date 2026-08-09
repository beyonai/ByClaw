export const getSkillGroupMemberDiff = (originalSkillIds: string[], nextSkillIds: string[]) => {
  const original = new Set(originalSkillIds);
  const next = new Set(nextSkillIds);
  return {
    addedSkillIds: nextSkillIds.filter((skillId) => !original.has(skillId)),
    removedSkillIds: originalSkillIds.filter((skillId) => !next.has(skillId)),
  };
};
