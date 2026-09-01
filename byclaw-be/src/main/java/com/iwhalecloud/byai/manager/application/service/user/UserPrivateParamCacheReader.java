package com.iwhalecloud.byai.manager.application.service.user;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

/** Reads enabled user-private parameters from their existing Redis runtime cache. */
@Service
public class UserPrivateParamCacheReader {

    private static final Logger log = LoggerFactory.getLogger(UserPrivateParamCacheReader.class);

    private final StringRedisTemplate redisTemplate;

    private final ObjectMapper objectMapper;

    public UserPrivateParamCacheReader(StringRedisTemplate redisTemplate, ObjectMapper objectMapper) {
        this.redisTemplate = redisTemplate;
        this.objectMapper = objectMapper;
    }

    /**
     * Returns one enabled personal parameter, or {@code null} when it is absent or the cache is unavailable.
     */
    public String getValue(String userCode, String paramKey) {
        String normalizedUserCode = StringUtils.trimToEmpty(userCode);
        String normalizedParamKey = StringUtils.upperCase(StringUtils.trimToEmpty(paramKey));
        if (normalizedUserCode.isEmpty() || normalizedParamKey.isEmpty()) {
            return null;
        }

        try {
            String redisKey = UserPrivateParamApplicationService.buildPrivateParamRedisKey(normalizedUserCode);
            String payload = redisTemplate.opsForValue().get(redisKey);
            if (StringUtils.isBlank(payload)) {
                return null;
            }
            JsonNode value = objectMapper.readTree(payload).path("params").path(normalizedParamKey);
            return value.isTextual() ? StringUtils.trimToNull(value.textValue()) : null;
        }
        catch (Exception ex) {
            log.warn("读取用户个人参数缓存失败，userCode={}，paramKey={}，reason={}",
                normalizedUserCode, normalizedParamKey, ex.getMessage());
            return null;
        }
    }
}
