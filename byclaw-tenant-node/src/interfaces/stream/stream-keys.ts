import { createHash } from "node:crypto";
export function sessionShard(sessionId: string): number {
  return Number(createHash("sha256").update(sessionId, "utf8").digest().readBigUInt64BE(0) % 16n);
}
export function inboundStream(enterpriseId: string): string {
  return `byclaw:tenant:{${enterpriseId}}:inbound:control`;
}
export function outboundStream(enterpriseId: string, shard: number): string {
  return `byclaw:tenant:{${enterpriseId}}:outbound:session:${shard}`;
}
export function consumerGroup(enterpriseId: string, generation: string, inbound: boolean): string {
  return `tenant-data-${enterpriseId}-g${generation}-${inbound ? "inbound" : "outbound"}-v1`;
}
