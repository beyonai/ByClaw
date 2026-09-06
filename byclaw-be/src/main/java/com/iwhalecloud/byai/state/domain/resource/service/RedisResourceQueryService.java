package com.iwhalecloud.byai.state.domain.resource.service;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.constants.staticdata.RedisConfig;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

/** Redis-only resource reads for low-latency runtime clients. */
@Service
public class RedisResourceQueryService {
    private static final String USER_CODE_KEY_PREFIX = "SHARE_BFM_USER_CODE_";
    private static final String AUTH_KEY_PREFIX = "USER:RESOURCES:AUTH:";
    private static final int MAX_BATCH_SIZE = 100;
    private static final Map<String, String> RESOURCE_KEY_PREFIXES = Map.of(
        "DIG_EMPLOYEE", "DIG_EMPLOYEE_", "KG_DOC", "KG_DOC_", "OBJECT", "OBJECT_",
        "VIEW", "VIEW_", "SCENE", "SCENE_", "ONTOLOGY_BASE", "ONTOLOGY_BASE_"
    );

    @Autowired
    private StringRedisTemplate redis;

    public Map<String, Object> query(Map<String, Object> request) {
        Map<String, Object> input = request == null ? Map.of() : request;
        String queryType = text(input.get("queryType"));
        if (queryType.isEmpty()) queryType = "BY_RESOURCE_ID";
        return switch (queryType.toUpperCase()) {
            case "AUTHORIZED_RESOURCE_IDS" -> authorizedResourceIds();
            case "BY_RESOURCE_ID" -> byResourceId(text(input.get("resourceId")));
            case "BATCH_BY_RESOURCE_IDS" -> batchByResourceIds(input.get("resourceIds"));
            case "BY_MODEL_ID" -> byModelId(text(input.get("modelId")));
            case "BATCH_BY_MODEL_IDS" -> batchByModelIds(input.get("modelIds"));
            default -> throw new IllegalArgumentException("Unsupported resource queryType: " + queryType);
        };
    }

    private Map<String, Object> authorizedResourceIds() {
        String userId = resolveUserId();
        Map<Object, Object> entries = redis.opsForHash().entries(AUTH_KEY_PREFIX + userId);
        List<Map<String, String>> resources = new ArrayList<>();
        entries.forEach((field, value) -> {
            String type = resourceType(value);
            if (RESOURCE_KEY_PREFIXES.containsKey(type)) {
                resources.add(Map.of("resourceId", text(field), "resourceType", type));
            }
        });
        return result("AUTHORIZED_RESOURCE_IDS", Map.of("userId", userId, "resources", resources));
    }

    private Map<String, Object> byResourceId(String resourceId) {
        if (resourceId.isEmpty()) throw new IllegalArgumentException("resourceId must not be empty");
        String userId = resolveUserId();
        String resourceType = authorizedType(userId, resourceId);
        if (resourceType == null) return result("BY_RESOURCE_ID", Map.of("allowed", false, "resourceId", resourceId));
        String prefix = RESOURCE_KEY_PREFIXES.get(resourceType);
        if (prefix == null) return result("BY_RESOURCE_ID", Map.of("allowed", false, "resourceId", resourceId, "reason", "UNSUPPORTED_RESOURCE_TYPE"));
        String raw = redis.opsForValue().get(prefix + resourceId);
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("resourceId", resourceId);
        item.put("resourceType", resourceType);
        item.put("allowed", true);
        item.put("data", raw == null || raw.isBlank() ? null : JSON.parseObject(raw));
        return result("BY_RESOURCE_ID", item);
    }

    private Map<String, Object> batchByResourceIds(Object rawIds) {
        List<String> ids = toIds(rawIds);
        if (ids.isEmpty()) throw new IllegalArgumentException("resourceIds must not be empty");
        if (ids.size() > MAX_BATCH_SIZE) throw new IllegalArgumentException("resourceIds exceeds max batch size " + MAX_BATCH_SIZE);
        String userId = resolveUserId();
        Map<Object, Object> authorized = redis.opsForHash().entries(AUTH_KEY_PREFIX + userId);
        List<String> authorizedIds = ids.stream().filter(id -> RESOURCE_KEY_PREFIXES.containsKey(resourceType(authorized.get(id)))).toList();
        List<String> keys = authorizedIds.stream().map(id -> RESOURCE_KEY_PREFIXES.get(resourceType(authorized.get(id))) + id).toList();
        List<String> values = redis.opsForValue().multiGet(keys);
        Map<String, String> rawById = new LinkedHashMap<>();
        for (int i = 0; i < authorizedIds.size(); i++) {
            String raw = values != null && i < values.size() ? values.get(i) : null;
            if (raw != null && !raw.isBlank()) rawById.put(authorizedIds.get(i), raw);
        }
        List<Map<String, Object>> items = new ArrayList<>();
        List<String> missing = new ArrayList<>();
        for (String id : ids) {
            String type = resourceType(authorized.get(id));
            if (!RESOURCE_KEY_PREFIXES.containsKey(type)) { items.add(Map.of("resourceId", id, "allowed", false)); continue; }
            String raw = rawById.get(id);
            if (raw == null || raw.isBlank()) { missing.add(id); continue; }
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("resourceId", id); item.put("resourceType", type); item.put("allowed", true); item.put("data", JSON.parseObject(raw));
            items.add(item);
        }
        return result("BATCH_BY_RESOURCE_IDS", Map.of("items", items, "missingResourceIds", missing));
    }

    /** Read one model directly from the Redis model hash; no database fallback. */
    private Map<String, Object> byModelId(String modelId) {
        if (modelId.isEmpty()) throw new IllegalArgumentException("modelId must not be empty");
        String raw = (String) redis.opsForHash().get(RedisConfig.AI_MODEL_KEY, modelId);
        Map<String, Object> model = raw == null || raw.isBlank() ? null : JSON.parseObject(raw);
        boolean usable = model != null
            && isEnabled(model.get("status"))
            && (text(model.get("modelType")).isEmpty() || "LLM".equalsIgnoreCase(text(model.get("modelType"))));
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("modelId", modelId);
        item.put("allowed", usable);
        item.put("data", usable ? model : null);
        return result("BY_MODEL_ID", item);
    }

    private Map<String, Object> batchByModelIds(Object rawIds) {
        List<String> ids = toIds(rawIds);
        if (ids.isEmpty()) throw new IllegalArgumentException("modelIds must not be empty");
        if (ids.size() > MAX_BATCH_SIZE) throw new IllegalArgumentException("modelIds exceeds max batch size " + MAX_BATCH_SIZE);
        List<Object> values = redis.opsForHash().multiGet(RedisConfig.AI_MODEL_KEY, new ArrayList<>(ids));
        List<Map<String, Object>> items = new ArrayList<>();
        for (int i = 0; i < ids.size(); i++) {
            Object value = values != null && i < values.size() ? values.get(i) : null;
            String raw = text(value);
            Map<String, Object> model = raw.isBlank() ? null : JSON.parseObject(raw);
            boolean usable = model != null && isEnabled(model.get("status"))
                && (text(model.get("modelType")).isEmpty() || "LLM".equalsIgnoreCase(text(model.get("modelType"))));
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("modelId", ids.get(i));
            item.put("allowed", usable);
            item.put("data", usable ? model : null);
            items.add(item);
        }
        return result("BATCH_BY_MODEL_IDS", Map.of("items", items));
    }

    private String resolveUserId() {
        String userCode = text(CurrentUserHolder.getCurrentUserCode());
        if (userCode.isEmpty()) throw new IllegalStateException("Current user code is unavailable");
        String userId = text(redis.opsForValue().get(USER_CODE_KEY_PREFIX + userCode));
        if (userId.isEmpty()) throw new IllegalStateException("User mapping is unavailable");
        return userId;
    }

    private String authorizedType(String userId, String resourceId) {
        Object value = redis.opsForHash().get(AUTH_KEY_PREFIX + userId, resourceId);
        return value == null ? null : resourceType(value);
    }

    private static String resourceType(Object value) {
        String raw = text(value); if (raw.isEmpty()) return "";
        String upper = raw.toUpperCase(); if (RESOURCE_KEY_PREFIXES.containsKey(upper)) return upper;
        try { Object parsed = JSON.parse(raw); if (parsed instanceof Map<?, ?> map) {
            Object type = map.get("resourceType"); if (type == null) type = map.get("resourceBizType"); return text(type).toUpperCase();
        }} catch (RuntimeException ignored) { }
        return "";
    }

    private static List<String> toIds(Object raw) {
        Set<String> ids = new LinkedHashSet<>();
        if (raw instanceof List<?> list) list.forEach(value -> { String id = text(value); if (!id.isEmpty()) ids.add(id); });
        else { String id = text(raw); if (!id.isEmpty()) ids.add(id); }
        return new ArrayList<>(ids);
    }

    private static Map<String, Object> result(String queryType, Map<String, Object> data) {
        Map<String, Object> result = new LinkedHashMap<>(); result.put("schemaVersion", "byclaw.resources.query/v1"); result.put("queryType", queryType); result.putAll(data); return result;
    }
    private static String text(Object value) { return value == null ? "" : String.valueOf(value).trim(); }
    private static boolean isEnabled(Object value) {
        String status = text(value);
        return "1".equals(status) || "ENABLED".equalsIgnoreCase(status) || "true".equalsIgnoreCase(status);
    }
}
