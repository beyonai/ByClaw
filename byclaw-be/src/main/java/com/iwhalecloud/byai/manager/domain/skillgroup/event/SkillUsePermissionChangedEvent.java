package com.iwhalecloud.byai.manager.domain.skillgroup.event;

import java.util.Collections;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;

public record SkillUsePermissionChangedEvent(
        Long skillResourceId, Long comAcctId, Set<Long> affectedUserIds, Long changedBy) {

    public SkillUsePermissionChangedEvent {
        Objects.requireNonNull(skillResourceId, "skillResourceId");
        Objects.requireNonNull(comAcctId, "comAcctId");
        TreeSet<Long> immutableUserIds = new TreeSet<>();
        if (affectedUserIds != null) {
            affectedUserIds.stream().filter(Objects::nonNull).forEach(immutableUserIds::add);
        }
        if (immutableUserIds.isEmpty()) {
            throw new IllegalArgumentException("affectedUserIds must not be empty");
        }
        affectedUserIds = Collections.unmodifiableSet(immutableUserIds);
    }
}
