package com.iwhalecloud.byai.gateway.sandbox.service;

import redis.clients.jedis.Jedis;
import redis.clients.jedis.commands.JedisCommands;

/** 接收 RedisClient.getCommands() 的句柄；只归还借出的单机连接，不关闭共享 Cluster。 */
public final class WorkerLeaseTtlSupport {
    private WorkerLeaseTtlSupport() { }

    public static Long read(JedisCommands commands, String key, Boolean online) {
        if (commands instanceof Jedis) {
            try (Jedis borrowed = (Jedis) commands) {
                return displayTtl(borrowed.ttl(key), online);
            }
        }
        // JedisCluster 由 RedisClient 管理生命周期，本次读取不能将其关闭。
        return displayTtl(commands.ttl(key), online);
    }

    private static Long displayTtl(Long ttl, Boolean online) {
        if (ttl != null && ttl >= 0) return ttl;
        return Long.valueOf(-2L).equals(ttl) && Boolean.FALSE.equals(online) ? 0L : null;
    }
}
