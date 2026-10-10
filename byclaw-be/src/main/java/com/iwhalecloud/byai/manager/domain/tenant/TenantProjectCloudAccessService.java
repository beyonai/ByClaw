package com.iwhalecloud.byai.manager.domain.tenant;

import com.fasterxml.jackson.databind.JsonNode;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantMembershipMapper;
import java.util.Map;
import org.springframework.stereotype.Service;

/** 云盘仍在平台存储，租户群成员以 Node 为准，不依赖邀请时的跨库成员同步。 */
@Service
public class TenantProjectCloudAccessService {
    private final TenantGroupData data;
    private final TenantAdminTenantMapper tenants;
    private final TenantMembershipMapper memberships;

    public TenantProjectCloudAccessService(TenantGroupData data, TenantAdminTenantMapper tenants,
        TenantMembershipMapper memberships) {
        this.data = data;
        this.tenants = tenants;
        this.memberships = memberships;
    }

    /** null 表示非租户群项目，继续原项目鉴权；明确拒绝或 Node 故障不得回退旧成员表。 */
    public Boolean canRead(Project project) {
        Long enterpriseId = project.getEnterpriseId();
        if (enterpriseId == null || enterpriseId <= 1
            || tenants.selectConfig(enterpriseId, "NODE_SANDBOX_RECORD_ID") == null) {
            return null;
        }
        Long userId = CurrentUserHolder.getCurrentUserId();
        if (userId == null) return false;
        var membership = memberships.selectActiveMembership(userId, enterpriseId);
        if (membership == null) return false;
        // 租户和项目取服务端绑定，用户取登录态；目录请求及 QA 回调不需要客户端补租户参数。
        var tenant = new TenantRequestContext(userId, enterpriseId, membership.getRole());
        JsonNode result = data.query(tenant, "group-chats/project-access",
            Map.of("projectId", project.getProjectId().toString()));
        if (result == null || !result.path("bound").isBoolean() || !result.path("canRead").isBoolean()) {
            return false;
        }
        return result.path("bound").asBoolean() ? result.path("canRead").asBoolean() : null;
    }
}
