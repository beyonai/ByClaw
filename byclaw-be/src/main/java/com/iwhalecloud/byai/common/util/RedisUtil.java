package com.iwhalecloud.byai.common.util;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.Cursor;
import org.springframework.data.redis.core.ScanOptions;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Component;

import com.baomidou.mybatisplus.core.toolkit.CollectionUtils;
import jakarta.annotation.PostConstruct;

/**
 * REDIS 工具类
 */
@Component
public class RedisUtil {

    private static RedisUtil instance;

    private static final Long RELEASE_SUCCESS = 1L;

    @Autowired
    private StringRedisTemplate stringRedisTemplate;

    @PostConstruct
    public void init() {
        synchronized (RedisUtil.class) {
            if (instance == null) {
                instance = this;
            }
        }
    }

    /**
     * 删除指定的键
     *
     * @param key 键名
     */
    public static void removeKey(String key) {
        instance.stringRedisTemplate.delete(key);
    }

    /**
     * 设置字符串值
     *
     * @param key 键名
     * @param value 字符串值
     */
    public static void setString(String key, String value) {
        instance.stringRedisTemplate.opsForValue().set(key, value);
    }

    /**
     * 设置字符串值并指定过期时间
     *
     * @param key 键名
     * @param value 字符串值
     * @param time 过期时间
     * @param timeUnit 时间单位
     */
    public static void setStringExp(String key, String value, long time, TimeUnit timeUnit) {
        instance.stringRedisTemplate.opsForValue().set(key, value, time, timeUnit);
    }

    /**
     * 获取字符串值
     *
     * @param key 键名
     * @return 字符串值，不存在返回null
     */
    public static String getString(String key) {
        return instance.stringRedisTemplate.opsForValue().get(key);
    }

    /**
     * 设置Hash字段值
     *
     * @param key 键名
     * @param hmKey 字段名
     * @param hmValue 字段值
     */
    public static void hmPut(String key, String hmKey, String hmValue) {
        if (StringUtil.isEmpty(key) || StringUtil.isEmpty(hmKey) || StringUtil.isEmpty(hmValue)) {
            return;
        }
        instance.stringRedisTemplate.opsForHash().put(key, hmKey, hmValue);
    }

    /**
     * 获取Hash字段值
     *
     * @param key 键名
     * @param hmKey 字段名
     * @return 字段值，不存在返回null
     */
    public static String hmGet(String key, String hmKey) {

        if (StringUtil.isEmpty(key) || StringUtil.isEmpty(hmKey)) {
            return null;
        }

        Object obj = instance.stringRedisTemplate.opsForHash().get(key, hmKey);
        return obj != null ? obj.toString() : null;
    }

    /**
     * 删除Hash字段
     *
     * @param key 键名
     * @param hmKey 字段名
     * @return 删除的字段数量，0表示字段不存在
     */
    public static Long hmDelete(String key, String hmKey) {
        if (StringUtil.isEmpty(key) || StringUtil.isEmpty(hmKey)) {
            return -1L;
        }
        return instance.stringRedisTemplate.opsForHash().delete(key, hmKey);
    }

    /**
     * 批量设置Hash字段值（对应Redis HMSET命令，单次网络往返）
     *
     * @param key 键名
     * @param entries 字段名-字段值映射
     */
    public static void hmPutAll(String key, Map<String, String> entries) {
        if (StringUtil.isEmpty(key) || entries == null || entries.isEmpty()) {
            return;
        }
        Map<String, Object> hashEntries = new HashMap<>(entries.size());
        hashEntries.putAll(entries);
        instance.stringRedisTemplate.opsForHash().putAll(key, hashEntries);
    }

    /**
     * 获取Hash所有字段值
     *
     * @param key 键名
     * @return 所有字段值的列表
     */
    public static List<Object> hmGetAll(String key) {
        return instance.stringRedisTemplate.opsForHash().values(key);
    }

    /**
     * 获取Set的所有成员
     *
     * @param key 键名
     * @return 成员集合
     */
    public static Set<String> members(String key) {
        return instance.stringRedisTemplate.opsForSet().members(key);
    }

    /**
     * 批量获取Set集合
     *
     * @param keys 键列表
     * @return 键到Set集合的映射
     */
    public static Map<String, Set<String>> getBatchSet(List<String> keys) {

        Map<String, Set<String>> resultMap = new HashMap<>(100);
        for (String key : keys) {
            Set<String> set = RedisUtil.members(key);
            if (set == null || set.isEmpty()) {
                continue;
            }
            resultMap.put(key, set);
        }
        return resultMap;
    }

    /**
     * 从Set集合中删除一个或多个元素
     *
     * @param key 键名
     * @param values 要删除的值
     */
    public static void removeSet(String key, String... values) {
        instance.stringRedisTemplate.opsForSet().remove(key, values);
    }

    /**
     * 当键不存在时设置值（原子操作）
     *
     * @param key 键名
     * @param value 值
     * @param timeOut 过期时间（秒）
     * @return true表示设置成功，false表示键已存在
     */
    public static Boolean setIfAbsent(String key, String value, Long timeOut) {
        return instance.stringRedisTemplate.opsForValue().setIfAbsent(key, value, timeOut, TimeUnit.SECONDS);
    }

    /**
     * 获取分布式锁
     *
     * @param key 锁的键名
     * @param value 锁的值（唯一标识）
     * @param lockExpireTime 锁的过期时间（秒）
     * @return true表示获取锁成功，false表示获取失败
     */
    public static Boolean lock(String key, String value, long lockExpireTime) {
        return instance.stringRedisTemplate.opsForValue().setIfAbsent(key, value, lockExpireTime, TimeUnit.SECONDS);
    }

    /**
     * 释放分布式锁
     *
     * @param key 锁的键名
     * @param value 锁的值（用于验证锁的持有者）
     * @return true表示释放成功，false表示释放失败
     */
    public static Boolean releaseLock(String key, String value) {
        String script = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
        RedisScript<Long> redisScript = new DefaultRedisScript<>(script, Long.class);
        Long result = (Long) instance.stringRedisTemplate.execute(redisScript, Collections.singletonList(key), value);
        return RELEASE_SUCCESS.equals(result);
    }

    /**
     * 批量获取字符串值（兼容单机和集群模式）
     *
     * @param keys 键列表
     * @return 值列表，与keys顺序对应，不存在的key返回null
     */
    public static List<String> getStrings(List<String> keys) {
        if (CollectionUtils.isEmpty(keys)) {
            return Collections.emptyList();
        }

        List<String> values = new ArrayList<>(keys.size());
        for (String key : keys) {
            values.add(getString(key));
        }
        return values;
    }

    /**
     * 批量设置字符串值（兼容单机和集群模式）
     *
     * @param keyValueMap 键值映射
     * @param time 过期时间
     * @param timeUnit 时间单位
     */
    public static void setStringsExp(Map<String, String> keyValueMap, long time, TimeUnit timeUnit) {
        if (keyValueMap == null || keyValueMap.isEmpty()) {
            return;
        }
        for (Map.Entry<String, String> entry : keyValueMap.entrySet()) {
            setStringExp(entry.getKey(), entry.getValue(), time, timeUnit);
        }
    }

    /**
     * 写入数据并设置过期时间
     *
     * @param key 键
     * @param value 值
     * @param timeout 过期时间
     * @param unit 时间单位
     */
    public static void setString(String key, String value, long timeout, TimeUnit unit) {
        instance.stringRedisTemplate.opsForValue().set(key, value, timeout, unit);
    }

    /**
     * 写入数据并设置过期时间（秒）
     *
     * @param key 键
     * @param value 值
     * @param timeoutSeconds 过期时间（秒）
     */
    public static void setString(String key, String value, long timeoutSeconds) {
        instance.stringRedisTemplate.opsForValue().set(key, value, timeoutSeconds, TimeUnit.SECONDS);
    }

    /**
     * 批量提取数据
     *
     * @param keys 键名列表
     * @return 对应值列表
     */
    public static List<String> getListString(List<String> keys) {
        return instance.stringRedisTemplate.opsForValue().multiGet(keys);
    }

    /**
     * 添加元素到Set集合
     *
     * @param key key
     * @param values 值
     */
    public static void addSet(String key, String... values) {
        instance.stringRedisTemplate.opsForSet().add(key, values);
    }

    /**
     * 是事存在这个key
     *
     * @param key key
     * @return Boolean
     */
    public static Boolean hasKey(String key) {
        return instance.stringRedisTemplate.hasKey(key);
    }

    /**
     * 获取set元素个数
     *
     * @param key 统计的key值
     * @return long
     */
    public static long countSet(String key) {
        Long size = instance.stringRedisTemplate.opsForSet().size(key);
        return size != null ? size : 0L;
    }

    /**
     * 递增计数器
     *
     * @param key 键
     * @return 递增后的值
     */
    public static Long increment(String key) {
        Long result = instance.stringRedisTemplate.opsForValue().increment(key);
        return result != null ? result : 0L;
    }

    /**
     * 删除指定的键
     * 对应Redis的DEL命令
     *
     * @param key 键名
     */
    public static void del(String key) {
        if (StringUtil.isEmpty(key)) {
            return;
        }
        instance.stringRedisTemplate.delete(key);
    }

    /**
     * 按前缀删除键。
     *
     * @param prefix 键前缀
     */
    public static void delByPrefix(String prefix) {
        if (StringUtil.isEmpty(prefix)) {
            return;
        }
        Set<String> keys = new java.util.HashSet<>();
        ScanOptions options = ScanOptions.scanOptions().match(prefix + "*").count(100).build();
        try (Cursor<byte[]> cursor = instance.stringRedisTemplate.executeWithStickyConnection(
                connection -> connection.keyCommands().scan(options))) {
            while (cursor != null && cursor.hasNext()) {
                keys.add(new String(cursor.next()));
            }
        } catch (Exception e) {
            throw new IllegalStateException("Scan redis keys by prefix failed, prefix=" + prefix, e);
        }
        if (keys == null || keys.isEmpty()) {
            return;
        }
        instance.stringRedisTemplate.delete(keys);
    }

    /**
     * 设置键值并指定过期时间（秒）
     * 对应Redis的SETEX命令
     *
     * @param key 键名
     * @param seconds 过期时间（秒）
     * @param value 字符串值
     */
    public static void setex(String key, int seconds, String value) {
        if (StringUtil.isEmpty(key)) {
            return;
        }
        instance.stringRedisTemplate.opsForValue().set(key, value, seconds, TimeUnit.SECONDS);
    }

    /**
     * 当键不存在时设置值（原子操作）
     * 对应Redis的SETNX命令
     *
     * @param key 键名
     * @param value 字符串值
     * @return true表示设置成功（键不存在），false表示键已存在
     */
    public static Boolean setnx(String key, String value) {
        if (StringUtil.isEmpty(key)) {
            return false;
        }
        return instance.stringRedisTemplate.opsForValue().setIfAbsent(key, value);
    }

}
