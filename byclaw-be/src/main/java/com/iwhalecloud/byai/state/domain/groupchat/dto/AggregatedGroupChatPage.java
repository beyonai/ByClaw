package com.iwhalecloud.byai.state.domain.groupchat.dto;

import java.util.List;

/** 跨企业群组聚合结果；单个企业失败不会导致整个列表失败。 */
public record AggregatedGroupChatPage(List<GroupChatListItemResponse> items, String nextCursor,
    boolean hasMore, boolean partial, List<FailedTenant> failedTenants) {
    public record FailedTenant(String enterpriseId, String enterpriseName, String reason) { }
}
