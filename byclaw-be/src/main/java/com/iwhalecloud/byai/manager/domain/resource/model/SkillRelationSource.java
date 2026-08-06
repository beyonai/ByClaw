package com.iwhalecloud.byai.manager.domain.resource.model;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONException;
import com.alibaba.fastjson.JSONObject;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class SkillRelationSource {

    private final boolean manual;
    private final boolean malformed;
    private final LinkedHashSet<Long> sourceGroupIds;

    private SkillRelationSource(boolean manual, boolean malformed) {
        this.manual = manual;
        this.malformed = malformed;
        this.sourceGroupIds = new LinkedHashSet<>();
    }

    public static SkillRelationSource parse(String json) {
        if (json == null || json.isBlank()) {
            return malformedManual();
        }

        try {
            Object parsed = JSON.parse(json);
            if (!(parsed instanceof JSONObject root)) {
                return malformedManual();
            }

            boolean hasManual = root.containsKey("manual");
            boolean hasGroupIds = root.containsKey("sourceGroupIds");
            Object manualValue = root.get("manual");
            Object groupIdsValue = root.get("sourceGroupIds");
            if (!hasManual && !hasGroupIds) {
                return malformedManual();
            }
            if (hasManual && !(manualValue instanceof Boolean)) {
                return malformedManual();
            }
            if (hasGroupIds && !(groupIdsValue instanceof JSONArray)) {
                return malformedManual();
            }

            boolean invalidGroupId = false;
            LinkedHashSet<Long> parsedGroupIds = new LinkedHashSet<>();
            if (groupIdsValue instanceof JSONArray groupIds) {
                for (Object groupIdValue : groupIds) {
                    if (groupIdValue == null) {
                        continue;
                    }
                    Long groupId = strictLong(groupIdValue);
                    if (groupId == null) {
                        invalidGroupId = true;
                    } else {
                        parsedGroupIds.add(groupId);
                    }
                }
            }

            SkillRelationSource source = new SkillRelationSource(
                Boolean.TRUE.equals(manualValue) || invalidGroupId,
                invalidGroupId
            );
            source.sourceGroupIds.addAll(parsedGroupIds);
            return source;
        } catch (JSONException ignored) {
            return malformedManual();
        }
    }

    public static SkillRelationSource manual() {
        return new SkillRelationSource(true, false);
    }

    private static SkillRelationSource malformedManual() {
        return new SkillRelationSource(true, true);
    }

    public boolean isManual() {
        return manual;
    }

    /**
     * Indicates that source metadata could not be parsed losslessly. Recoverable numeric group IDs remain available
     * for conservative delete guards and install canonicalization, but uninstall must leave malformed rows untouched.
     *
     * @return {@code true} when the original metadata was malformed or legacy/unknown
     */
    public boolean isMalformed() {
        return malformed;
    }

    public Set<Long> getSourceGroupIds() {
        return Collections.unmodifiableSet(new LinkedHashSet<>(sourceGroupIds));
    }

    public void addGroup(Long groupId) {
        if (groupId != null) {
            sourceGroupIds.add(groupId);
        }
    }

    public void removeGroup(Long groupId) {
        if (groupId != null) {
            sourceGroupIds.remove(groupId);
        }
    }

    public boolean hasGroup(Long groupId) {
        return groupId != null && sourceGroupIds.contains(groupId);
    }

    public boolean hasAnySource() {
        return manual || !sourceGroupIds.isEmpty();
    }

    public SkillRelationSource withoutManual() {
        SkillRelationSource source = new SkillRelationSource(false, malformed);
        source.sourceGroupIds.addAll(sourceGroupIds);
        return source;
    }

    public String toJson() {
        List<Long> sortedGroupIds = new ArrayList<>(sourceGroupIds);
        Collections.sort(sortedGroupIds);
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("manual", manual);
        root.put("sourceGroupIds", sortedGroupIds);
        return JSON.toJSONString(root);
    }

    private static Long strictLong(Object value) {
        if (value instanceof Byte || value instanceof Short || value instanceof Integer || value instanceof Long) {
            return ((Number) value).longValue();
        }
        if (value instanceof BigInteger bigInteger
            && bigInteger.compareTo(BigInteger.valueOf(Long.MIN_VALUE)) >= 0
            && bigInteger.compareTo(BigInteger.valueOf(Long.MAX_VALUE)) <= 0) {
            return bigInteger.longValue();
        }
        return null;
    }
}
