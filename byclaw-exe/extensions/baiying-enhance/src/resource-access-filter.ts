/** Each shared employee is adapted for the current user, before workspace seeds or skill downloads are built. */
export function filterControlledResources(
  raw: unknown,
  authorizedIds: ReadonlySet<string>,
  userId: string,
): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const root = raw as Record<string, unknown>;
  if (!Array.isArray(root.controlledResources) || root.controlledResources.length === 0) return raw;
  const denied = new Set<string>();
  const deniedSkillCodes = new Set<string>();
  for (const value of root.controlledResources) {
    if (!value || typeof value !== "object") continue;
    const policy = value as Record<string, unknown>;
    const id = String(policy.resourceId ?? "");
    if (policy.active !== false && (authorizedIds.has(id) || (userId && String(policy.createBy ?? "") === userId))) continue;
    if (id) denied.add(id);
    const code = String(policy.resourceCode ?? "");
    if (code && policy.resourceBizType === "SKILL") deniedSkillCodes.add(code);
  }
  const allowed = (value: unknown, skill: boolean): boolean => {
    if (typeof value === "string" || typeof value === "number") {
      return !(skill ? deniedSkillCodes : denied).has(String(value));
    }
    if (!value || typeof value !== "object") return true;
    const item = value as Record<string, unknown>;
    const id = item.resourceId ?? item.skillId ?? item.relId ?? item.id;
    if (id != null) return !denied.has(String(id));
    return !skill || ![item.resourceCode, item.skillCode].some((code) => code != null && deniedSkillCodes.has(String(code)));
  };
  const filtered = { ...root };
  for (const field of ["relSkills", "skills", "relIds", "relResourceList", "relResourceInfoList"]) {
    let values = root[field];
    const encoded = typeof values === "string";
    if (encoded) {
      try { values = JSON.parse(values as string); } catch { continue; }
    }
    if (Array.isArray(values)) {
      const kept = values.filter((value) => allowed(value, field === "skills" || field === "relSkills"));
      filtered[field] = encoded ? JSON.stringify(kept) : kept;
    }
  }
  return filtered;
}
