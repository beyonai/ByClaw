package com.iwhalecloud.byai.common.discovery;

import com.iwhaleai.byai.framework.common.Constants.RegistryKeys;
import com.iwhaleai.byai.framework.common.RedisClient;
import java.util.Map;
import redis.clients.jedis.Jedis;
import redis.clients.jedis.commands.JedisCommands;

/** Clears a service's registry entries using the same keys as the gateway SDK. */
public final class ServiceRegistryCleanup {

    private ServiceRegistryCleanup() {
    }

    public static void clear(RedisClient redisClient, String serviceName) {
        JedisCommands commands = redisClient.getCommands();
        if (commands instanceof Jedis borrowed) {
            try (borrowed) {
                clearEntries(borrowed, serviceName);
            }
        }
        else {
            // RedisClient owns the shared cluster handle.
            clearEntries(commands, serviceName);
        }
    }

    private static void clearEntries(JedisCommands commands, String serviceName) {
        String instancesKey = RegistryKeys.sdInstanceDetails(serviceName);
        String activeKey = RegistryKeys.sdActiveInstances(serviceName);
        Map<String, String> instances = commands.hgetAll(instancesKey);
        if (instances != null && !instances.isEmpty()) {
            String[] instanceIds = instances.keySet().toArray(new String[0]);
            commands.hdel(instancesKey, instanceIds);
            commands.zrem(activeKey, instanceIds);
        }
        // Route each command by its own key, including the global service index.
        commands.del(instancesKey);
        commands.del(activeKey);
        commands.srem(RegistryKeys.sdServices(), serviceName);
    }
}
