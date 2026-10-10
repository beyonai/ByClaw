import { DomainError } from "../domain/errors.js";
import { requireId, text } from "../domain/values.js";
import { bounded } from "./history/paging.js";

export interface SessionRepository {
  children?(
    actor: string,
    parentId: string,
    page: number,
    size: number,
  ): Promise<{
    list: Record<string, any>[];
    total: number;
    pageNum: number;
    pageSize: number;
  }>;
  list(
    actor: string,
    page: number,
    size: number,
    keyword: string,
    types: string[],
    projectId?: string,
    agentId?: string,
    parentSessionId?: string,
  ): Promise<unknown>;
}
/** 个人会话查询入口；校验分页及类型，按当前用户查询；私有任务过滤由仓储完成。 */
export class SessionQueries {
  constructor(private readonly repository: SessionRepository) {}
  async children(actor: string, parentId: string, page?: number, size?: number) {
    requireId(actor);
    requireId(parentId);
    if (!this.repository.children) throw new DomainError("INVALID_QUERY");
    return this.repository.children(
      actor,
      parentId,
      bounded(page, 1, 100000),
      bounded(size, 100, 100),
    );
  }
  async list(actor: string, input: Record<string, any>) {
    return this.query(actor, input);
  }
  async childrenQuery(actor: string, parentSessionId: string, input: Record<string, any>) {
    return this.query(actor, input, requireId(parentSessionId));
  }
  private async query(actor: string, input: Record<string, any>, parentSessionId?: string) {
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
    if (parentSessionId)
      return this.repository.list(
        actor,
        page,
        size,
        keyword,
        types,
        projectId,
        agentId,
        parentSessionId,
      );
    if (agentId) return this.repository.list(actor, page, size, keyword, types, projectId, agentId);
    return projectId
      ? this.repository.list(actor, page, size, keyword, types, projectId)
      : this.repository.list(actor, page, size, keyword, types);
  }
}
