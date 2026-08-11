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

    private static final long VERSION_2 = 2L;
    private static final Set<String> VERSION_2_KEYS = Set.of(
        "version", "manual", "sourceGroupIds", "legacySourceGroupIds", "groupInstallers"
    );

    private final boolean manual;
    private final boolean malformed;
    private boolean version2;
    private final LinkedHashSet<Long> legacySourceGroupIds;
    private final LinkedHashMap<Long, LinkedHashSet<Long>> groupInstallers;

    private SkillRelationSource(boolean manual, boolean malformed, boolean version2) {
        this.manual = manual;
        this.malformed = malformed;
        this.version2 = version2;
        this.legacySourceGroupIds = new LinkedHashSet<>();
        this.groupInstallers = new LinkedHashMap<>();
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

            if (root.containsKey("version")) {
                return Long.valueOf(VERSION_2).equals(strictLong(root.get("version")))
                    ? parseVersion2(root)
                    : malformedManual();
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
                invalidGroupId,
                false
            );
            source.legacySourceGroupIds.addAll(parsedGroupIds);
            return source;
        } catch (JSONException ignored) {
            return malformedManual();
        }
    }

    private static SkillRelationSource parseVersion2(JSONObject root) {
        if (!root.keySet().equals(VERSION_2_KEYS)
            || !(root.get("manual") instanceof Boolean manualValue)
            || !(root.get("sourceGroupIds") instanceof JSONArray sourceGroupIdsValue)
            || !(root.get("legacySourceGroupIds") instanceof JSONArray legacySourceGroupIdsValue)
            || !(root.get("groupInstallers") instanceof JSONObject groupInstallersValue)) {
            return malformedManual();
        }

        LinkedHashSet<Long> sourceGroupIds = strictLongSet(sourceGroupIdsValue);
        LinkedHashSet<Long> legacySourceGroupIds = strictLongSet(legacySourceGroupIdsValue);
        if (sourceGroupIds == null || legacySourceGroupIds == null) {
            return malformedManual();
        }

        LinkedHashMap<Long, LinkedHashSet<Long>> groupInstallers = new LinkedHashMap<>();
        for (Map.Entry<String, Object> entry : groupInstallersValue.entrySet()) {
            Long groupId = strictLongKey(entry.getKey());
            if (groupId == null || !(entry.getValue() instanceof JSONArray installerValues)) {
                return malformedManual();
            }
            LinkedHashSet<Long> installerIds = strictLongSet(installerValues);
            if (installerIds == null || installerIds.isEmpty()) {
                return malformedManual();
            }
            groupInstallers.put(groupId, installerIds);
        }

        LinkedHashSet<Long> compatibilityGroupIds = new LinkedHashSet<>(legacySourceGroupIds);
        compatibilityGroupIds.addAll(groupInstallers.keySet());
        if (!sourceGroupIds.equals(compatibilityGroupIds)) {
            return malformedManual();
        }

        SkillRelationSource source = new SkillRelationSource(manualValue, false, true);
        source.legacySourceGroupIds.addAll(legacySourceGroupIds);
        source.groupInstallers.putAll(groupInstallers);
        return source;
    }

    public static SkillRelationSource manual() {
        return new SkillRelationSource(true, false, false);
    }

    private static SkillRelationSource malformedManual() {
        return new SkillRelationSource(true, true, false);
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
        LinkedHashSet<Long> sourceGroupIds = new LinkedHashSet<>(legacySourceGroupIds);
        sourceGroupIds.addAll(groupInstallers.keySet());
        return Collections.unmodifiableSet(sourceGroupIds);
    }

    public Set<Long> getLegacySourceGroupIds() {
        return Collections.unmodifiableSet(new LinkedHashSet<>(legacySourceGroupIds));
    }

    public Map<Long, Set<Long>> getGroupInstallers() {
        Map<Long, Set<Long>> copy = new LinkedHashMap<>();
        groupInstallers.forEach((groupId, installerIds) ->
            copy.put(groupId, Collections.unmodifiableSet(new LinkedHashSet<>(installerIds)))
        );
        return Collections.unmodifiableMap(copy);
    }

    public void addGroup(Long groupId) {
        if (groupId != null) {
            legacySourceGroupIds.add(groupId);
        }
    }

    public void removeGroup(Long groupId) {
        if (groupId != null) {
            legacySourceGroupIds.remove(groupId);
            groupInstallers.remove(groupId);
        }
    }

    public boolean hasGroup(Long groupId) {
        return groupId != null && (legacySourceGroupIds.contains(groupId) || groupInstallers.containsKey(groupId));
    }

    public void addGroupInstaller(Long groupId, Long userId) {
        if (groupId != null && userId != null) {
            version2 = true;
            groupInstallers.computeIfAbsent(groupId, ignored -> new LinkedHashSet<>()).add(userId);
        }
    }

    public void removeGroupInstaller(Long groupId, Long userId) {
        if (groupId == null || userId == null) {
            return;
        }
        LinkedHashSet<Long> installerIds = groupInstallers.get(groupId);
        if (installerIds != null && installerIds.remove(userId) && installerIds.isEmpty()) {
            groupInstallers.remove(groupId);
        }
    }

    public boolean hasGroupInstaller(Long groupId, Long userId) {
        return groupId != null
            && userId != null
            && groupInstallers.containsKey(groupId)
            && groupInstallers.get(groupId).contains(userId);
    }

    public void removeInstallerFromAllGroups(Long userId) {
        if (userId == null) {
            return;
        }
        groupInstallers.entrySet().removeIf(entry -> {
            entry.getValue().remove(userId);
            return entry.getValue().isEmpty();
        });
    }

    public boolean hasAnySource() {
        return manual || !legacySourceGroupIds.isEmpty() || !groupInstallers.isEmpty();
    }

    public SkillRelationSource withManual() {
        return copyWithManual(true);
    }

    public SkillRelationSource withoutManual() {
        return copyWithManual(false);
    }

    private SkillRelationSource copyWithManual(boolean manualValue) {
        SkillRelationSource source = new SkillRelationSource(manualValue, malformed, version2);
        source.legacySourceGroupIds.addAll(legacySourceGroupIds);
        groupInstallers.forEach((groupId, installerIds) ->
            source.groupInstallers.put(groupId, new LinkedHashSet<>(installerIds))
        );
        return source;
    }

    public String toJson() {
        Map<String, Object> root = new LinkedHashMap<>();
        if (version2) {
            root.put("version", VERSION_2);
        }
        root.put("manual", manual);
        root.put("sourceGroupIds", sorted(getSourceGroupIds()));
        if (version2) {
            root.put("legacySourceGroupIds", sorted(legacySourceGroupIds));
            Map<String, Object> sortedInstallers = new LinkedHashMap<>();
            List<Long> sortedInstallerGroupIds = sorted(groupInstallers.keySet());
            for (Long groupId : sortedInstallerGroupIds) {
                sortedInstallers.put(String.valueOf(groupId), sorted(groupInstallers.get(groupId)));
            }
            root.put("groupInstallers", sortedInstallers);
        }
        return JSON.toJSONString(root);
    }

    private static List<Long> sorted(Set<Long> values) {
        List<Long> sortedValues = new ArrayList<>(values);
        Collections.sort(sortedValues);
        return sortedValues;
    }

    private static LinkedHashSet<Long> strictLongSet(JSONArray values) {
        LinkedHashSet<Long> result = new LinkedHashSet<>();
        for (Object value : values) {
            Long parsedValue = strictLong(value);
            if (parsedValue == null) {
                return null;
            }
            result.add(parsedValue);
        }
        return result;
    }

    private static Long strictLongKey(String value) {
        try {
            Long parsed = Long.valueOf(value);
            return String.valueOf(parsed).equals(value) ? parsed : null;
        } catch (NumberFormatException ignored) {
            return null;
        }
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
