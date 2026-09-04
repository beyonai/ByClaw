/** BE metadata.project_info 的业务快照；只保留模型需要的项目与资源字段。 */
export interface ProjectContext {
  project_id?: string | number;
  project_name?: string;
  workspace?: string;
  project_resources?: ProjectResourceContext[];
}

export interface ProjectResourceContext {
  resourceId?: string | number;
  resourceName?: string;
  resourceCode?: string;
  resourceType?: string;
}

/** 兼容对象及 JSON 字符串；可选 metadata 损坏时不阻断普通对话。 */
export function parseProjectContext(value: unknown): ProjectContext | undefined {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  const record = asRecord(value);
  if (!record) return undefined;
  const projectId = identifier(record.project_id);
  const projectName = nonEmptyString(record.project_name);
  const workspace = projectWorkspace(record.workspace);
  const resources = Array.isArray(record.project_resources)
    ? record.project_resources.flatMap((value): ProjectResourceContext[] => {
        const resource = asRecord(value);
        if (!resource) return [];
        const resourceId = identifier(resource.resourceId);
        const resourceName = nonEmptyString(resource.resourceName);
        const resourceCode = nonEmptyString(resource.resourceCode);
        const resourceType = nonEmptyString(resource.resourceType);
        if (resourceId === undefined && !resourceName && !resourceCode && !resourceType) return [];
        return [
          {
            ...(resourceId !== undefined ? { resourceId } : {}),
            ...(resourceName ? { resourceName } : {}),
            ...(resourceCode ? { resourceCode } : {}),
            ...(resourceType ? { resourceType } : {}),
          },
        ];
      })
    : undefined;
  if (projectId === undefined && !projectName && !workspace && !resources?.length) return undefined;
  return {
    ...(projectId !== undefined ? { project_id: projectId } : {}),
    ...(projectName ? { project_name: projectName } : {}),
    ...(workspace ? { workspace } : {}),
    ...(resources ? { project_resources: resources } : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

function identifier(value: unknown): string | number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : nonEmptyString(value);
}

function projectWorkspace(value: unknown): string | undefined {
  const path = nonEmptyString(value);
  return path?.startsWith("/") && !path.split("/").includes("..") && !/[\u0000-\u001f]/.test(path)
    ? path
    : undefined;
}
