package com.iwhalecloud.byai.state.domain.groupchat.application;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.domain.tenant.TenantModeService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeClient;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContext;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantMembershipMapper;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantMembershipRow;
import com.iwhalecloud.byai.state.domain.groupchat.dto.AggregatedGroupChatPage;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatListItemResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import jakarta.annotation.PreDestroy;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** 跨企业群组聚合查询；不改变现有单企业群组列表接口。 */
@Service
public class AggregatedGroupChatService {
    private static final Logger LOG = LoggerFactory.getLogger(AggregatedGroupChatService.class);
    /** 公共库是一个聚合来源，不对应某一个真实企业；游标用 0 表示该来源。 */
    private static final long SHARED_SOURCE_ID = 0L;
    private static final int MAX_PAGE_SIZE = 100;
    private static final int MAX_NODE_CONCURRENCY = 5;
    private static final Duration TENANT_TIMEOUT = Duration.ofSeconds(3);

    private final TenantMembershipMapper memberships;
    private final TenantModeService tenantModes;
    private final TenantNodeClient node;
    private final GroupChatReadService publicGroups;
    private final ObjectMapper mapper;
    private final ExecutorService executor = Executors.newFixedThreadPool(MAX_NODE_CONCURRENCY);

    public AggregatedGroupChatService(TenantMembershipMapper memberships, TenantModeService tenantModes,
        TenantNodeClient node, GroupChatReadService publicGroups, ObjectMapper mapper) {
        this.memberships = memberships;
        this.tenantModes = tenantModes;
        this.node = node;
        this.publicGroups = publicGroups;
        this.mapper = mapper;
    }

    /**
     * 查询当前用户所有企业的群组。游标记录每个企业已经消费的偏移量，
     * 某个租户超时或异常时只进入 failedTenants，不影响其他租户结果。
     */
    public AggregatedGroupChatPage list(Integer requestedSize, String cursor) {
        int pageSize = requestedSize == null || requestedSize < 1 ? 20 : Math.min(requestedSize, MAX_PAGE_SIZE);
        Long userId = CurrentUserHolder.getCurrentUserId();
        if (userId == null || userId <= 0) {
            throw new ResponseStatusException(org.springframework.http.HttpStatus.UNAUTHORIZED, "tenant.login.required");
        }
        Map<Long, Integer> offsets = decodeCursor(cursor);
        List<TenantMembershipRow> tenants = memberships.selectAvailableForUser(userId);
        List<Candidate> candidates = new ArrayList<>();
        List<AggregatedGroupChatPage.FailedTenant> failed = new ArrayList<>();
        List<Future<TenantResult>> futures = new ArrayList<>();
        List<Source> sources = new ArrayList<>();
        long deadlineNanos = System.nanoTime() + TENANT_TIMEOUT.toNanos();
        // 默认企业、免费试用租户和历史公共群都在同一个库，公共来源只查询一次。
        sources.add(new Source(SHARED_SOURCE_ID, 0L, "公共工作区"));
        for (TenantMembershipRow tenant : tenants) {
            long enterpriseId = Long.parseLong(tenant.getEnterpriseId());
            if (tenantModes.isSharedDataTenant(enterpriseId)) continue;
            sources.add(new Source(enterpriseId, enterpriseId, tenant.getEnterpriseName()));
        }
        for (Source source : sources) {
            int offset = offsets.getOrDefault(source.sourceId(), 0);
            futures.add(executor.submit(() -> loadSource(userId, source, offset, pageSize)));
        }
        List<Boolean> tenantHasMore = new ArrayList<>();
        for (int index = 0; index < futures.size(); index++) {
            Future<TenantResult> future = futures.get(index);
            Source source = sources.get(index);
            try {
                long remainingNanos = deadlineNanos - System.nanoTime();
                if (remainingNanos <= 0) throw new java.util.concurrent.TimeoutException();
                TenantResult result = future.get(remainingNanos, TimeUnit.NANOSECONDS);
                if (result.failure() != null) failed.add(result.failure());
                else {
                    candidates.addAll(result.items());
                    tenantHasMore.add(result.hasMore());
                }
            } catch (Exception error) {
                future.cancel(true);
                failed.add(new AggregatedGroupChatPage.FailedTenant(source.displayId(),
                    source.displayName(), "TENANT_QUERY_TIMEOUT"));
            }
        }
        candidates.sort(Comparator.comparing(Candidate::updatedAt, Comparator.nullsLast(Comparator.reverseOrder()))
            .thenComparingLong(candidate -> candidate.item().getEnterpriseId() == null ? 0L : candidate.item().getEnterpriseId())
            .thenComparingLong(candidate -> candidate.item().getSessionId()));
        List<Candidate> selected = candidates.stream().limit(pageSize).toList();
        Map<Long, Integer> nextOffsets = new HashMap<>(offsets);
        // 每个来源要前进“本次实际取走的条数”。如果只加 1，某个来源一次返回多条时，
        // 下一页会重复读取已经展示过的群组；按来源计数才能保证游标稳定推进。
        Map<Long, Integer> consumedBySource = new HashMap<>();
        selected.forEach(candidate -> consumedBySource.merge(candidate.sourceId(), 1, Integer::sum));
        consumedBySource.forEach((sourceId, consumed) -> nextOffsets.merge(sourceId, consumed, Integer::sum));
        // 失败租户只记录在 partial/failedTenants 中，不制造“永远有下一页”的假游标；
        // 公共库和其他可用租户的结果应当可以正常结束分页。
        boolean hasMore = tenantHasMore.stream().anyMatch(Boolean.TRUE::equals)
            || selected.size() == pageSize;
        return new AggregatedGroupChatPage(selected.stream().map(Candidate::item).toList(),
            hasMore ? encodeCursor(nextOffsets) : null, hasMore, !failed.isEmpty(), failed);
    }

    private TenantResult loadSource(long userId, Source source, int offset, int pageSize) {
        try {
            int page = offset / pageSize + 1;
            int skip = offset % pageSize;
            List<GroupChatListItemResponse> groups;
            boolean shared = source.sourceId() == SHARED_SOURCE_ID;
            if (shared) {
                PageInfo<GroupChatListItemResponse> result = publicGroups.listMyGroupsInEnterprise(
                    userId, page, pageSize, null);
                groups = result == null || result.getList() == null ? List.of() : result.getList();
            } else {
                TenantRequestContext context = new TenantRequestContext(userId, source.enterpriseId(), "MEMBER");
                Map<String, Object> raw = node.request(context, "GET",
                    "/internal/v1/group-chats?pageNum=" + page + "&pageSize=" + pageSize,
                    null, new TypeReference<Map<String, Object>>() { });
                Object list = raw == null ? null : raw.get("list");
                groups = list == null ? List.of()
                    : mapper.convertValue(list, new TypeReference<List<GroupChatListItemResponse>>() { });
            }
            int rawSize = groups.size();
            if (skip >= rawSize) return new TenantResult(List.of(), rawSize == pageSize, null);
            List<GroupChatListItemResponse> visible = groups.subList(skip, rawSize);
            if (!shared) {
                visible.forEach(group -> {
                    group.setEnterpriseId(source.enterpriseId());
                    group.setEnterpriseName(source.displayName());
                });
            }
            return new TenantResult(visible.stream()
                    .map(group -> new Candidate(source.sourceId(), group)).toList(),
                rawSize == pageSize, null);
        } catch (Exception error) {
            LOG.warn("Aggregated group query failed for source {}: {}", source.displayId(),
                error.getClass().getSimpleName());
            return new TenantResult(List.of(), false, new AggregatedGroupChatPage.FailedTenant(
                source.displayId(), source.displayName(), reason(error)));
        }
    }

    private String reason(Exception error) {
        if (error instanceof java.util.concurrent.TimeoutException) return "TENANT_QUERY_TIMEOUT";
        if (error instanceof ResponseStatusException status) return "TENANT_QUERY_" + status.getStatusCode().value();
        return "TENANT_QUERY_FAILED";
    }

    private Map<Long, Integer> decodeCursor(String cursor) {
        if (cursor == null || cursor.isBlank()) return Map.of();
        try {
            String json = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8);
            Map<String, Integer> values = mapper.readValue(json, new TypeReference<Map<String, Integer>>() { });
            Map<Long, Integer> result = new HashMap<>();
            values.forEach((key, value) -> { if (key.matches("[0-9]+") && value != null && value >= 0) result.put(Long.valueOf(key), value); });
            return result;
        } catch (Exception error) {
            throw new ResponseStatusException(org.springframework.http.HttpStatus.BAD_REQUEST, "groupchat.aggregate.cursor.invalid");
        }
    }

    private String encodeCursor(Map<Long, Integer> offsets) {
        try {
            Map<String, Integer> values = new java.util.TreeMap<>();
            offsets.forEach((key, value) -> values.put(Long.toString(key), value));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(mapper.writeValueAsBytes(values));
        } catch (Exception error) {
            throw new IllegalStateException("groupchat aggregate cursor encode failed", error);
        }
    }

    private record Source(long sourceId, long enterpriseId, String displayName) {
        String displayId() { return sourceId == SHARED_SOURCE_ID ? "shared" : Long.toString(enterpriseId); }
    }

    private record Candidate(long sourceId, GroupChatListItemResponse item) {
        java.util.Date updatedAt() { return item.getLatestMessageTime(); }
    }
    private record TenantResult(List<Candidate> items, boolean hasMore,
        AggregatedGroupChatPage.FailedTenant failure) { }

    @PreDestroy
    void shutdown() {
        executor.shutdownNow();
    }
}
