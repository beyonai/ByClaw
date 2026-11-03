package com.iwhalecloud.byai.manager.qo.index;

import java.util.Date;
import java.util.List;
import lombok.AllArgsConstructor;
import lombok.Getter;

/** 服务端生成的卡片所属组织筛选上下文，不接受客户端授权上下文。 */
@Getter
@AllArgsConstructor
public class EmployeeAudienceFilter {
    private final Long tenantId;
    private final Long viewerId;
    private final boolean administrator;
    private final boolean company;
    private final Date now;
    private final List<Long> rootOrgIds;
    private final List<Long> visibleOrgIds;
    private final List<OrganizationMatch> matches;

    public int getRootOrgCount() { return rootOrgIds.size(); }

    @Getter
    @AllArgsConstructor
    public static class OrganizationMatch {
        private final List<Long> orgIds;
        // 存在这些祖先范围时，卡片会折叠子组织，不能按隐藏的子组织命中。
        private final List<Long> ancestorIds;
    }
}
