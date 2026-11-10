package com.iwhalecloud.byai.state.domain.groupchat.integration;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.iwhalecloud.byai.manager.domain.tenant.TenantModeService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeClient;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContext;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatMentionMapper;
import org.springframework.stereotype.Component;

/** 角标来自当前企业的全量未读聚合，不把前端已加载页数的计数冒充总未读。 */
@Component
public class WorkgroupUnreadService {
    private final TenantModeService modes;
    private final TenantNodeClient node;
    private final ByaiGroupChatMentionMapper groups;

    public WorkgroupUnreadService(TenantModeService modes, TenantNodeClient node, ByaiGroupChatMentionMapper groups) {
        this.modes = modes;
        this.node = node;
        this.groups = groups;
    }

    public int count(long accountId, long enterpriseId) {
        long count = 0;
        if (modes.isSharedDataTenant(enterpriseId)) {
            for (var group : groups.selectMyGroups(accountId, enterpriseId)) {
                count = Math.addExact(count, Math.max(0, group.getUnreadMessageCount()));
            }
        } else {
            JsonNode result = node.request(new TenantRequestContext(accountId, enterpriseId, "MEMBER"),
                "GET", "/internal/v1/group-chats?pageNum=1&pageSize=1", null,
                new TypeReference<JsonNode>() { });
            JsonNode unread = result.path("totalUnreadMessageCount");
            if (!unread.isIntegralNumber() || !unread.canConvertToLong() || unread.asLong() < 0) {
                throw new IllegalStateException("Unread aggregate unavailable");
            }
            count = unread.asLong();
        }
        return (int) Math.min(9999, count);
    }
}
