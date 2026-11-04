package com.iwhalecloud.byai.manager.application.service.auth;

import java.util.*;
import lombok.Data;

@Data
public class AuthorizationCachePlan {
    private Map<String, Set<String>> additions = new LinkedHashMap<>();
    private Map<String, Set<String>> removals = new LinkedHashMap<>();
    private Set<Long> userIds = new LinkedHashSet<>();

    void change(Map<String, Set<String>> values, boolean remove) {
        Map<String, Set<String>> target = remove ? removals : additions;
        Map<String, Set<String>> opposite = remove ? additions : removals;
        values.forEach((key, members) -> {
            opposite.getOrDefault(key, new HashSet<>()).removeAll(members);
            target.computeIfAbsent(key, ignored -> new LinkedHashSet<>()).addAll(members);
        });
    }
}
