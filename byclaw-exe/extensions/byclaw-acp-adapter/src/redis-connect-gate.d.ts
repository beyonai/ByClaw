export type RedisConnectGateOptions = {
  isReady: () => boolean;
  connect: () => Promise<void>;
};

export declare function createRedisConnectGate(
  options: RedisConnectGateOptions,
): () => Promise<void>;
