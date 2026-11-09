package com.iwhalecloud.byai.common.constants.resource;

import com.alibaba.fastjson.JSON;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/** Conversation capability retirement, independent of historical storage and resource permissions. */
public final class RetiredConversationResources {
    public static final Set<String> TYPES = Set.of("OBJECT", "VIEW", "ONTOLOGY_BASE", "SCENE");
    public static final String REASON = "RESOURCE_TYPE_RETIRED";
    private static final List<String> TYPE_FIELDS = List.of("resourceBizType", "resourceType", "resource_type");
    private static final Set<String> ID_LIST_FIELDS = Set.of("relIds", "resourceIds", "resource_ids");

    private RetiredConversationResources() { }

    public static boolean isRetired(Object type) {
        return type != null && TYPES.contains(String.valueOf(type).trim().toUpperCase(Locale.ROOT));
    }

    public static boolean isRetiredResource(Map<?, ?> resource) {
        return resource != null && TYPE_FIELDS.stream().anyMatch(field -> isRetired(resource.get(field)));
    }

    public static void requireAvailable(String type) {
        if (isRetired(type)) throw new IllegalArgumentException(REASON);
    }

    /** Copy the runtime projection; never mutate database snapshots, history or user-authored prompts. */
    public static String sanitizeRuntimeJson(String json) {
        if (json == null || json.isBlank()) return json;
        Object parsed = JSON.parse(json);
        Set<String> retiredIds = new LinkedHashSet<>();
        collectRetiredIds(parsed, retiredIds);
        return JSON.toJSONString(sanitize(parsed, retiredIds, ""));
    }

    private static void collectRetiredIds(Object value, Set<String> ids) {
        if (value instanceof Map<?, ?> map) {
            if (isRetiredResource(map)) {
                for (String field : List.of("resourceId", "resource_id", "id", "relId")) {
                    if (map.get(field) != null) ids.add(String.valueOf(map.get(field)));
                }
            }
            map.values().forEach(child -> collectRetiredIds(child, ids));
        } else if (value instanceof List<?> list) {
            list.forEach(child -> collectRetiredIds(child, ids));
        }
    }

    private static Object sanitize(Object value, Set<String> retiredIds, String field) {
        if (value instanceof Map<?, ?> map) {
            if (isRetiredResource(map) || (map.get("relId") != null
                && retiredIds.contains(String.valueOf(map.get("relId"))))) return null;
            Map<String, Object> result = new LinkedHashMap<>();
            map.forEach((key, child) -> {
                String name = String.valueOf(key);
                // A snapshot must not recursively expose an earlier, unfiltered employee snapshot.
                if ("targetContent".equals(name) || "target_content".equals(name)) return;
                Object filtered = sanitize(child, retiredIds, name);
                if (filtered != null || child == null) result.put(name, filtered);
            });
            return result;
        }
        if (value instanceof List<?> list) {
            List<Object> result = new ArrayList<>();
            for (Object child : list) {
                if (ID_LIST_FIELDS.contains(field) && retiredIds.contains(String.valueOf(child))) continue;
                Object filtered = sanitize(child, retiredIds, field);
                if (filtered != null) result.add(filtered);
            }
            return result;
        }
        return value;
    }
}
