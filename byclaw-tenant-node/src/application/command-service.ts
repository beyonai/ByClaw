import { DomainError } from "../domain/errors.js";
import type { TenantCommand } from "./command.js";
export interface CommandTransaction {
  lock(sessionId: string): Promise<void>;
  authorize(command: TenantCommand): Promise<void>;
  previous(
    command: TenantCommand,
  ): Promise<{ hash: string; userId: string; result: Record<string, any> } | null>;
  apply(command: TenantCommand): Promise<Record<string, any>>;
  record(command: TenantCommand, result: Record<string, any>): Promise<void>;
}
export interface CommandTransactions {
  run<T>(work: (tx: CommandTransaction) => Promise<T>): Promise<T>;
}
/** 在同一事务内完成会话串行化、权限判断、业务写入和幂等结果记录。 */
export class CommandService {
  constructor(
    private readonly transactions: CommandTransactions,
    private readonly requireExecution: () => Promise<void> = async () => {},
  ) {}
  execute(command: TenantCommand): Promise<Record<string, any>> {
    return this.transactions.run(async (tx) => {
      await tx.lock(command.sessionId);
      // 先返回已提交结果：离群或删除后的同一请求重投，不能再次鉴权后重复执行。
      const previous = await tx.previous(command);
      if (previous) {
        if (previous.hash !== command.requestHash || previous.userId !== command.userId)
          throw new DomainError("IDEMPOTENCY_CONFLICT");
        if (
          command.operation === "CREATE_DIRECT_TASK" ||
          command.operation === "CREATE_DIRECT_SESSION"
        ) {
          // 升级前存下的命令回执可能指向历史副本。重新进入仍通过同一群锁解析固定会话。
          await this.requireExecution();
          await tx.authorize(command);
          return tx.apply(command);
        }
        if (
          command.operation === "PUBLISH_TASK" &&
          typeof previous.result.data?.newlyPublished === "boolean"
        ) {
          // 回执内容不可变，当前请求没有再次发消息。私聊发布重放也须验证原群及员工成员资格。
          await tx.authorize(command);
          return { ...previous.result, data: { ...previous.result.data, newlyPublished: false } };
        }
        if (Array.isArray(previous.result.data?.savedMembers)) {
          return { ...previous.result, data: { ...previous.result.data, savedMembers: [] } };
        }
        return previous.result;
      }
      await this.requireExecution();
      await tx.authorize(command);
      const result = await tx.apply(command);
      await tx.record(command, result);
      return result;
    });
  }
}
