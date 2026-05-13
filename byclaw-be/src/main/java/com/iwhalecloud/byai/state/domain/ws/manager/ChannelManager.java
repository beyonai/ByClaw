package com.iwhalecloud.byai.state.domain.ws.manager;

import java.util.Collections;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Service;

import io.netty.channel.Channel;
import lombok.extern.slf4j.Slf4j;

/**
 * WebSocket Channel 管理器，支持同一用户多设备登录（多 Channel）。
 * 使用 {@link ConcurrentHashMap} 保证线程安全。
 */
@Slf4j
@Service
public class ChannelManager {

    private static final Map<Long, Set<Channel>> USER_CHANNELS = new ConcurrentHashMap<>();

    /**
     * 为用户添加一个 WebSocket Channel（支持多设备）
     *
     * @param userId  用户ID
     * @param channel WebSocket Channel
     */
    public void addChannel(Long userId, Channel channel) {
        USER_CHANNELS.computeIfAbsent(userId, k -> ConcurrentHashMap.newKeySet()).add(channel);
        log.debug("添加 Channel, userId: {}, 当前连接数: {}", userId, USER_CHANNELS.get(userId).size());
    }

    /**
     * 移除用户的指定 Channel；当该用户无剩余 Channel 时，清除整个条目
     *
     * @param userId  用户ID
     * @param channel 要移除的 Channel
     */
    public static void removeChannel(Long userId, Channel channel) {
        USER_CHANNELS.computeIfPresent(userId, (key, channels) -> {
            channels.remove(channel);
            return channels.isEmpty() ? null : channels;
        });
        log.debug("移除 Channel, userId: {}, 剩余连接数: {}", userId,
            USER_CHANNELS.containsKey(userId) ? USER_CHANNELS.get(userId).size() : 0);
    }

    /**
     * 移除用户的全部 Channel
     *
     * @param userId 用户ID
     */
    public static void removeAllChannels(Long userId) {
        USER_CHANNELS.remove(userId);
    }

    /**
     * 获取用户的所有活跃 Channel
     *
     * @param userId 用户ID
     * @return 该用户的所有 Channel，不存在时返回空集合
     */
    public Set<Channel> getChannels(Long userId) {
        return USER_CHANNELS.getOrDefault(userId, Collections.emptySet());
    }

    /**
     * 获取所有在线用户ID
     *
     * @return 用户ID集合
     */
    public Set<Long> getAllUserIds() {
        return USER_CHANNELS.keySet();
    }

    /**
     * 获取指定用户的活跃连接数
     *
     * @param userId 用户ID
     * @return 连接数
     */
    public int getChannelCount(Long userId) {
        Set<Channel> channels = USER_CHANNELS.get(userId);
        return channels != null ? channels.size() : 0;
    }
}
