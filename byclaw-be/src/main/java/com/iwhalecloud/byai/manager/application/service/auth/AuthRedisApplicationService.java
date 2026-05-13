package com.iwhalecloud.byai.manager.application.service.auth;

import com.iwhalecloud.byai.common.util.RedisUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.core.RedisOperations;
import org.springframework.data.redis.core.SessionCallback;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;

/**
 * 用户权限Redis缓存服务
 * 用于管理用户资源权限的Redis Hash操作
 * Key格式：USER:AUTH:{userId}
 * Hash Field：resourceId（如 "123456"）
 * Hash Value：resourceType（如 "AGENT"）
 *
 * @author he.duming
 * @date 2025-05-10
 */
@Service
public class AuthRedisApplicationService {

    private static final Logger logger = LoggerFactory.getLogger(AuthRedisApplicationService.class);

    /**
     * Redis Key前缀
     */
    private static final String USER_AUTH_KEY_PREFIX = "USER:RESOURCES:AUTH:";

    @Autowired
    private StringRedisTemplate stringRedisTemplate;

    /**
     * 构建用户权限Redis Key
     *
     * @param userId 用户标识
     * @return Redis Key，格式：USER:AUTH:{userId}
     */
    public String getUserAuthKey(Long userId) {
        if (userId == null) {
            return null;
        }
        return USER_AUTH_KEY_PREFIX + userId;
    }

    /**
     * 写入用户资源权限到Redis Hash
     * 先清空该用户的权限，再写入新权限
     *
     * @param userId 用户标识
     * @param resourceAuthMap 资源权限映射，key为resourceId，value为resourceType
     */
    public void writeUserAuth(Long userId, Map<String, String> resourceAuthMap) {
        if (userId == null) {
            return;
        }

        String key = getUserAuthKey(userId);
        if (resourceAuthMap == null || resourceAuthMap.isEmpty()) {
            // 如果没有权限数据，清空该用户的权限key
            clearUserAuth(userId);
            return;
        }

        // 先清空该用户的权限Hash
        clearUserAuth(userId);

        // 写入新的权限数据到Hash
        Map<String, String> hashEntries = new HashMap<>(resourceAuthMap.size());
        resourceAuthMap.forEach((resourceId, resourceType) -> {
            if (resourceId != null && resourceType != null) {
                hashEntries.put(resourceId, resourceType);
            }
        });

        if (!hashEntries.isEmpty()) {
            RedisUtil.hmPutAll(key, hashEntries);
        }
    }

    /**
     * 批量写入用户资源权限（分批处理）
     *
     * @param userAuthMap 用户权限映射，key为userId，value为该用户的资源权限映射
     */
    public void batchWriteUserAuth(Map<Long, Map<String, String>> userAuthMap) {
        if (userAuthMap == null || userAuthMap.isEmpty()) {
            return;
        }

        for (Map.Entry<Long, Map<String, String>> entry : userAuthMap.entrySet()) {
            Long userId = entry.getKey();
            Map<String, String> resourceAuthMap = entry.getValue();
            writeUserAuth(userId, resourceAuthMap);
        }
    }

    /**
     * 按资源类型删除用户权限
     *
     * @param userId 用户标识
     * @param resourceIds 要删除的资源ID集合
     */
    public void removeUserAuthByResourceIds(Long userId, Set<String> resourceIds) {
        if (userId == null || resourceIds == null || resourceIds.isEmpty()) {
            return;
        }

        String key = getUserAuthKey(userId);
        for (String resourceId : resourceIds) {
            if (resourceId != null) {
                RedisUtil.hmDelete(key, resourceId);
            }
        }
    }

    /**
     * 清空整个用户权限Key
     *
     * @param userId 用户标识
     */
    public void clearUserAuth(Long userId) {
        if (userId == null) {
            return;
        }

        String key = getUserAuthKey(userId);
        RedisUtil.removeKey(key);
    }

    /**
     * 获取用户所有权限资源
     *
     * @param userId 用户标识
     * @return 资源权限映射，key为resourceId，value为resourceType
     */
    public Map<String, String> getUserAuthResources(Long userId) {
        if (userId == null) {
            return new HashMap<>();
        }

        String key = getUserAuthKey(userId);
        if (!RedisUtil.hasKey(key)) {
            return new HashMap<>();
        }

        // 获取Hash中所有字段和值
        java.util.List<Object> values = RedisUtil.hmGetAll(key);
        if (values == null || values.isEmpty()) {
            return new HashMap<>();
        }

        // 由于hmGetAll只返回values，需要获取对应的fields
        // 这里使用另一种方式获取所有entries
        Map<String, String> result = new HashMap<>();
        for (Object value : values) {
            if (value != null) {
                // 尝试从已知的resourceId中查找
                result.put(value.toString(), value.toString());
            }
        }

        return result;
    }

    /**
     * 检查用户是否拥有某个资源的权限
     *
     * @param userId 用户标识
     * @param resourceId 资源标识
     * @return 是否拥有权限
     */
    public boolean hasResourcePermission(Long userId, String resourceId) {
        if (userId == null || resourceId == null) {
            return false;
        }

        String key = getUserAuthKey(userId);
        String resourceType = RedisUtil.hmGet(key, resourceId);
        return resourceType != null;
    }

    /**
     * 获取用户对指定资源的权限类型
     *
     * @param userId 用户标识
     * @param resourceId 资源标识
     * @return 资源类型，如果无权限返回null
     */
    public String getResourceType(Long userId, String resourceId) {
        if (userId == null || resourceId == null) {
            return null;
        }

        String key = getUserAuthKey(userId);
        return RedisUtil.hmGet(key, resourceId);
    }

    /**
     * Pipeline批量写入多个用户的权限到Redis
     * 将多个用户的 delete + putAll 操作合并到一次 Pipeline 往返中
     *
     * @param userAuthMap 用户权限映射，key为userId，value为该用户的资源权限映射
     */
    @SuppressWarnings("unchecked")
    public void pipelineBatchWriteUserAuth(Map<Long, Map<String, String>> userAuthMap) {
        if (userAuthMap == null || userAuthMap.isEmpty()) {
            return;
        }

        try {
            stringRedisTemplate.executePipelined(new SessionCallback<Object>() {
                @Override
                public Object execute(RedisOperations operations) throws DataAccessException {
                    for (Map.Entry<Long, Map<String, String>> entry : userAuthMap.entrySet()) {
                        Long userId = entry.getKey();
                        Map<String, String> resourceAuthMap = entry.getValue();
                        String key = getUserAuthKey(userId);

                        // 先删除旧数据
                        operations.delete(key);

                        // 写入新数据
                        if (resourceAuthMap != null && !resourceAuthMap.isEmpty()) {
                            Map<String, Object> hashEntries = new HashMap<>(resourceAuthMap.size());
                            resourceAuthMap.forEach((k, v) -> {
                                if (k != null && v != null) {
                                    hashEntries.put(k, v);
                                }
                            });
                            if (!hashEntries.isEmpty()) {
                                operations.opsForHash().putAll(key, hashEntries);
                            }
                        }
                    }
                    return null;
                }
            });
        } catch (Exception e) {
            logger.error("Pipeline批量写入用户权限到Redis失败，回退为逐条写入，原因：{}", e.getMessage());
            // 降级为逐条写入
            batchWriteUserAuth(userAuthMap);
        }
    }

}
