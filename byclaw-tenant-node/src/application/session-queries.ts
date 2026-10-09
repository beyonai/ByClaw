import { DomainError } from "../domain/errors.js";
import { requireId, text } from "../domain/values.js";
import { bounded } from "./history/paging.js";

export interface SessionRepository {
  list(
    actor: string,
    page: number,
    size: number,
    keyword: string,
    types: string[],
    projectId?: string,
    agentId?: string,
  ): Promise<unknown>;
}
/** 个人会话查询入口；校验分页及类型，按当前用户查询；私有任务过滤由仓储完成。 */
export class SessionQueries {
  constructor(private readonly repository: SessionRepository) {}
  async list(actor: string, input: Record<string, any>) {
    if (
      Object.keys(input).some(
        (key) =>
          !["pageNum", "pageSize", "keyword", "sessionTypes", "projectId", "agentId"].includes(key),
      )
    )
      throw new DomainError("INVALID_QUERY");
    const page = bounded(input.pageNum, 1, 100000),
      size = bounded(input.pageSize, 25, 100);
    const keyword = text(input.keyword ?? "", 255).replace(/[\%_]/g, "\$&");
    const types = input.sessionTypes ?? ["h_as"];
    if (
      !Array.isArray(types) ||
      !types.length ||
      types.some((type) => !["h_as", "h_h", "hs_as"].includes(type))
    )
      throw new DomainError("INVALID_SESSION_TYPES");
    const projectId =
      input.projectId == null
        ? undefined
        : input.projectId === "-1" || input.projectId === -1
          ? "-1"
          : requireId(input.projectId);
    const agentId = input.agentId == null ? undefined : requireId(input.agentId);
    if (agentId) return this.repository.list(actor, page, size, keyword, types, projectId, agentId);
    return projectId
      ? this.repository.list(actor, page, size, keyword, types, projectId)
      : this.repository.list(actor, page, size, keyword, types);
  }
}
