package com.iwhalecloud.byai.state.domain.chat.service;

import java.io.OutputStream;
import java.util.concurrent.ConcurrentHashMap;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * OutputStream 连接管理器 用于在 chat 请求和 Redis 消息监听之间共享 OutputStream 连接及聊天上下文
 */
@Component
public class OutputStreamManager {

    private static final Logger logger = LoggerFactory.getLogger(OutputStreamManager.class);

    /**
     * 缓存 OutputStream 连接，key 为 userCode + ":" + sessionId
     */
    private final ConcurrentHashMap<String, OutputStream> outputStreamMap = new ConcurrentHashMap<>();

    /**
     * 缓存 ChatProcessContext，key 为 sessionId（字符串形式），供 Redis 监听器在异步 Gateway 模式下 完成 storeMessage / afterProcess 延迟步骤时使用
     */
    private final ConcurrentHashMap<String, ChatProcessContext> contextMap = new ConcurrentHashMap<>();

    /**
     * 缓存 OutputStream
     *
     * @param key 缓存 key
     * @param outputStream 输出流
     */
    public void put(String key, OutputStream outputStream) {
        outputStreamMap.put(key, outputStream);
        logger.info("OutputStream 已缓存, key: {}", key);
    }

    /**
     * 获取 OutputStream
     *
     * @param key 缓存 key
     * @return OutputStream，不存在返回 null
     */
    public OutputStream get(String key) {
        return outputStreamMap.get(key);
    }

    /**
     * 移除 OutputStream（不关闭）
     *
     * @param key 缓存 key
     * @return 被移除的 OutputStream
     */
    public OutputStream remove(String key) {
        return outputStreamMap.remove(key);
    }

    /**
     * 检查是否存在指定 key 的 OutputStream
     *
     * @param key 缓存 key
     * @return 是否存在
     */
    public boolean containsKey(String key) {
        return outputStreamMap.containsKey(key);
    }

    // -------------------- ChatProcessContext 缓存方法 --------------------

    /**
     * 缓存 ChatProcessContext，key 为 sessionId 字符串
     *
     * @param sessionId 会话标识（Long 转 String）
     * @param context 聊天流程上下文
     */
    public void putContext(String sessionId, ChatProcessContext context) {
        contextMap.put(sessionId, context);
        logger.info("ChatProcessContext 已缓存, sessionId: {}", sessionId);
    }

    /**
     * 获取 ChatProcessContext
     *
     * @param sessionId 会话标识
     * @return ChatProcessContext，不存在则返回 null
     */
    public ChatProcessContext getContext(String sessionId) {
        return contextMap.get(sessionId);
    }

    /**
     * 移除 ChatProcessContext
     *
     * @param sessionId 会话标识
     * @return 被移除的 ChatProcessContext
     */
    public ChatProcessContext removeContext(String sessionId) {
        ChatProcessContext ctx = contextMap.remove(sessionId);
        if (ctx != null) {
            logger.info("ChatProcessContext 已移除, sessionId: {}", sessionId);
        }
        return ctx;
    }
}
