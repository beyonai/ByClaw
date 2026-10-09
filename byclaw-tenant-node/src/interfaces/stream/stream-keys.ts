import { createHash } from "node:crypto";
/** 协议固定为 SHA-256(sessionId UTF-8) 首 8 字节无符号大端值 mod 16，生产方必须一致。 */
export function sessionShard(sessionId: string): number {
  return Number(createHash("sha256").update(sessionId, "utf8").digest().readBigUInt64BE(0) % 16n);
}
export function inboundStream(enterpriseId: string): string {
  return `byclaw:tenant:{${enterpriseId}}:inbound:control`;
}
export function outboundStream(enterpriseId: string, shard: number): string {
  return `byclaw:tenant:{${enterpriseId}}:outbound:session:${shard}`;
}
/** 消费组绑定租户和代际；旧代际 pending 由 BE 对账，不能当作本代际已成功处理。 */
export function consumerGroup(enterpriseId: string, generation: string, inbound: boolean): string {
  return `tenant-data-${enterpriseId}-g${generation}-${inbound ? "inbound" : "outbound"}-v1`;
}
