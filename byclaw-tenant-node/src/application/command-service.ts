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
export class CommandService {
  constructor(private readonly transactions: CommandTransactions) {}
  execute(command: TenantCommand): Promise<Record<string, any>> {
    return this.transactions.run(async (tx) => {
      await tx.lock(command.sessionId);
      const previous = await tx.previous(command);
      if (previous) {
        if (previous.hash !== command.requestHash || previous.userId !== command.userId)
          throw new DomainError("IDEMPOTENCY_CONFLICT");
        return previous.result;
      }
      await tx.authorize(command);
      const result = await tx.apply(command);
      await tx.record(command, result);
      return result;
    });
  }
}
