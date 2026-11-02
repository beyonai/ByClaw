package com.iwhalecloud.byai.common.quota;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/** 仅读取 HACU 专用云盘投影，其他 ByClaw 配额不会自动启用容量限制。 @author Codex @since 2026-11-02 */
@Component
public class HacuStoragePolicyReader {
    private static final Logger LOG = LoggerFactory.getLogger(HacuStoragePolicyReader.class);
    private final StringRedisTemplate redis;
    private final ObjectMapper mapper;
    private final SharedQuotaProperties properties;

    public HacuStoragePolicyReader(StringRedisTemplate redis, ObjectMapper mapper, SharedQuotaProperties properties) {
        this.redis = redis;
        this.mapper = mapper;
        this.properties = properties;
    }

    /** @param enterpriseId 资源归属 @param required 已有商业托管标记 @return 字节额度，明确不限额或无套餐为 null */
    public Long read(long enterpriseId, boolean required) {
        Map<Object, Object> fields;
        try {
            fields = redis.opsForHash().entries(properties.getKeyPrefix() + "storage:{" + enterpriseId + "}");
        } catch (RuntimeException failure) {
            LOG.error("Storage policy read failed, enterpriseId={}", enterpriseId, failure);
            // 开源部署未标记商业托管，不因新增 HACU 依赖中断原存文件功能。
            if (!required && !wrongType(failure)) {
                return null;
            }
            throw unavailable();
        }
        if (fields != null && fields.isEmpty() && !required) {
            return null;
        }
        try {
            if (fields == null || fields.isEmpty()) {
                throw unavailable();
            }
            String revision = (String) fields.get("revision");
            String payload = (String) fields.get("payload");
            String hash = (String) fields.get("payloadHash");
            if (revision == null || !revision.matches("[1-9][0-9]{0,18}") || payload == null || hash == null
                    || !hash.matches("[0-9a-f]{64}")) {
                throw unavailable();
            }
            Long.parseLong(revision);
            String actualHash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest(payload.getBytes(StandardCharsets.UTF_8)));
            if (!MessageDigest.isEqual(hash.getBytes(StandardCharsets.US_ASCII), actualHash.getBytes(StandardCharsets.US_ASCII))) {
                throw unavailable();
            }
            JsonNode policy = mapper.reader().with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readTree(payload);
            if (policy == null || !policy.path("schemaVersion").isIntegralNumber()
                    || !policy.path("schemaVersion").canConvertToInt() || policy.path("schemaVersion").intValue() != 1
                    || !"HACU".equals(policy.path("source").textValue())
                    || !"HACU_WORKGROUP".equals(policy.path("scope").textValue())
                    || !Long.toString(enterpriseId).equals(policy.path("enterpriseId").textValue())
                    || !revision.equals(policy.path("revision").textValue())
                    || !revision.equals(redis.opsForHash().get(properties.getKeyPrefix() + "{" + enterpriseId + "}", "revision"))) {
                throw unavailable();
            }
            if ("UNLIMITED".equals(policy.path("mode").textValue())) {
                return null;
            }
            JsonNode limit = policy.path("storageBytes");
            if (!"LIMITED".equals(policy.path("mode").textValue()) || !limit.isTextual()
                    || !limit.textValue().matches("[0-9]{1,19}")) {
                throw unavailable();
            }
            return Long.valueOf(limit.textValue());
        } catch (Exception failure) {
            LOG.error("Storage policy invalid or not fully published, enterpriseId={}", enterpriseId, failure);
            throw unavailable();
        }
    }

    /** @return 沿用当前共享前缀，企业 hash tag 兼容 Redis Cluster */
    public String pendingKey(long enterpriseId) {
        return properties.getKeyPrefix() + "storage-write:{" + enterpriseId + "}";
    }

    private boolean wrongType(Throwable failure) {
        for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
            if (cause.getMessage() != null && cause.getMessage().contains("WRONGTYPE")) {
                return true;
            }
        }
        return false;
    }

    public static ResponseStatusException unavailable() {
        return new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, I18nUtil.get("hacu.storage.quota.unavailable"));
    }
}
