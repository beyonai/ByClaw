package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.model;

import java.util.List;
import java.util.Map;
import java.util.Set;

public record RobotConfigSnapshot(
        long snapshotVersion,
        Map<String, DingtalkRobotChannelConfig> byRobotCode,
        Map<Long, List<DingtalkRobotChannelConfig>> byResourceId,
        Map<Long, List<DingtalkRobotChannelConfig>> ownedConfigsByResourceId,
        Map<String, Set<Long>> ownersByRobotCode,
        Set<Long> onlineResourceIds,
        Set<String> conflictedRobotCodes,
        Set<Long> invalidResourceIds
) {

    public RobotConfigSnapshot {
        byRobotCode = Map.copyOf(byRobotCode);
        byResourceId = Map.copyOf(byResourceId);
        ownedConfigsByResourceId = Map.copyOf(ownedConfigsByResourceId);
        ownersByRobotCode = Map.copyOf(ownersByRobotCode);
        onlineResourceIds = Set.copyOf(onlineResourceIds);
        conflictedRobotCodes = Set.copyOf(conflictedRobotCodes);
        invalidResourceIds = Set.copyOf(invalidResourceIds);
    }

    public static RobotConfigSnapshot empty() {
        return new RobotConfigSnapshot(0L, Map.of(), Map.of(), Map.of(), Map.of(), Set.of(), Set.of(), Set.of());
    }
}
