package com.iwhalecloud.byai.manager.application.service.auth;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.dto.auth.AuthorizationSubject;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.auth.AuthorizationSubjectMapper;
import com.iwhalecloud.byai.manager.mapper.auth.PrivilegeGrantMapper;
import java.util.*;

/** Scoped to one append operation, never shared across requests or retained after writes. */
final class AuthorizationPermissionSnapshot implements AutoCloseable {
    private static final ThreadLocal<AuthorizationPermissionSnapshot> CURRENT = new ThreadLocal<>();
    private final AuthorizationPermissionSnapshot previous;
    private final Map<Long, Set<String>> subjects = new HashMap<>();
    private final Map<Long, Map<String, List<PrivilegeGrant>>> grants = new HashMap<>();
    private final Set<Long> validated = new HashSet<>();
    private final Map<String, List<PrivilegeGrant>> allGrants = new HashMap<>();
    private final boolean allResources;

    AuthorizationPermissionSnapshot(Collection<SsResource> resources, Collection<Long> users,
        AuthorizationSubjectMapper memberships, PrivilegeGrantMapper mapper) {
        previous = CURRENT.get();
        allResources = resources == null;
        List<Long> ids = users.stream().filter(Objects::nonNull).distinct().toList();
        ids.forEach(id -> subjects.put(id, new HashSet<>(Set.of("USER:" + id))));
        for (int start = 0; start < ids.size(); start += 500) {
            for (AuthorizationSubject row : memberships.memberships(ids.subList(start, Math.min(start + 500, ids.size())))) {
                Set<String> userSubjects = subjects.get(row.getUserId());
                // Station inheritance follows station_id_path, including the station itself only if present there.
                if (!"STATION".equals(row.getSubjectType()) && row.getSubjectId() != null) {
                    userSubjects.add(row.getSubjectType() + ":" + row.getSubjectId());
                }
                if (row.getSubjectPath() != null) {
                    for (String part : row.getSubjectPath().split("\\.")) {
                        if (part.isBlank()) continue;
                        long id = Long.parseLong(part.trim());
                        if (!"STATION".equals(row.getSubjectType()) || id >= 0) userSubjects.add(row.getSubjectType() + ":" + id);
                    }
                }
            }
        }
        if (allResources) {
            Map<String, Set<Long>> targetIds = new HashMap<>();
            subjects.values().forEach(values -> values.forEach(value -> {
                String[] parts = value.split(":", 2);
                targetIds.computeIfAbsent(parts[0], ignored -> new HashSet<>()).add(Long.valueOf(parts[1]));
            }));
            targetIds.forEach((type, targets) -> {
                List<Long> subjectIds = new ArrayList<>(targets);
                for (int start = 0; start < subjectIds.size(); start += 500) {
                    for (PrivilegeGrant grant : mapper.selectList(new LambdaQueryWrapper<PrivilegeGrant>()
                        .eq(PrivilegeGrant::getGrantToObjType, type)
                        .in(PrivilegeGrant::getGrantToObjId, subjectIds.subList(start, Math.min(start + 500, subjectIds.size())))
                        .eq(PrivilegeGrant::getStatusCd, "A"))) {
                        allGrants.computeIfAbsent(type + ":" + grant.getGrantToObjId(), ignored -> new ArrayList<>()).add(grant);
                    }
                }
            });
            CURRENT.set(this);
            return;
        }
        List<Long> resourceIds = resources.stream().map(SsResource::getResourceId).distinct().toList();
        resourceIds.forEach(id -> grants.put(id, new HashMap<>()));
        for (int start = 0; start < resourceIds.size(); start += 500) {
            List<PrivilegeGrant> rows = mapper.selectList(new LambdaQueryWrapper<PrivilegeGrant>()
                .in(PrivilegeGrant::getGrantObjId, resourceIds.subList(start, Math.min(start + 500, resourceIds.size())))
                .in(PrivilegeGrant::getGrantType, List.of("ALLOW_MANAGE", "AVAILABLE_USE", "FORCE_USE"))
                .eq(PrivilegeGrant::getStatusCd, "A"));
            for (PrivilegeGrant grant : rows) {
                grants.get(grant.getGrantObjId()).computeIfAbsent(
                    grant.getGrantToObjType() + ":" + grant.getGrantToObjId(), ignored -> new ArrayList<>()).add(grant);
            }
        }
        CURRENT.set(this);
    }

    static List<PrivilegeGrant> findAll(Long userId, String type, List<String> types, List<String> resourceTypes) {
        AuthorizationPermissionSnapshot snapshot = CURRENT.get();
        if (snapshot == null || !snapshot.allResources || !snapshot.subjects.containsKey(userId)) return null;
        List<PrivilegeGrant> result = new ArrayList<>();
        for (String subject : snapshot.subjects.get(userId)) {
            for (PrivilegeGrant grant : snapshot.allGrants.getOrDefault(subject, List.of())) {
                if (types != null && !types.isEmpty() ? !types.contains(grant.getGrantType())
                    : type != null && !type.isBlank() && !type.equals(grant.getGrantType())) continue;
                if (resourceTypes == null || resourceTypes.isEmpty() || resourceTypes.contains(grant.getGrantObjType())) result.add(grant);
            }
        }
        return result;
    }

    static List<PrivilegeGrant> find(SsResource resource, Long userId, Collection<String> types) {
        AuthorizationPermissionSnapshot snapshot = CURRENT.get();
        if (snapshot == null || !snapshot.subjects.containsKey(userId) || !snapshot.grants.containsKey(resource.getResourceId())) return null;
        Map<String, List<PrivilegeGrant>> bySubject = snapshot.grants.get(resource.getResourceId());
        List<PrivilegeGrant> result = new ArrayList<>();
        for (String subject : snapshot.subjects.get(userId)) {
            for (PrivilegeGrant grant : bySubject.getOrDefault(subject, List.of())) {
                if (types.contains(grant.getGrantType()) && Objects.equals(resource.getResourceBizType(), grant.getGrantObjType())) result.add(grant);
            }
        }
        return result;
    }

    static boolean alreadyValidated(Long resourceId) {
        return CURRENT.get() != null && CURRENT.get().validated.contains(resourceId);
    }

    static void validated(Long resourceId) {
        if (CURRENT.get() != null) CURRENT.get().validated.add(resourceId);
    }

    @Override public void close() {
        if (previous == null) CURRENT.remove(); else CURRENT.set(previous);
    }
}
