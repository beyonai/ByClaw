/** 可公开的业务错误码；接口返回 code，不透传数据库异常中的 SQL 或凭证。 */
export class DomainError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
