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
  ): Promise<unknown>;
}
export class SessionQueries {
  constructor(private readonly repository: SessionRepository) {}
  async list(actor: string, input: Record<string, any>) {
    if (
      Object.keys(input).some(
        (key) => !["pageNum", "pageSize", "keyword", "sessionTypes", "projectId"].includes(key),
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
    return projectId
      ? this.repository.list(actor, page, size, keyword, types, projectId)
      : this.repository.list(actor, page, size, keyword, types);
  }
}
