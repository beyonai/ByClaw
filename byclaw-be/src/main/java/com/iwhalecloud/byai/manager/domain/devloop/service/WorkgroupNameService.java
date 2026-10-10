package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.fasterxml.jackson.core.type.TypeReference;
import com.iwhalecloud.byai.common.util.RuntimeEnvironment;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeClient;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContextHolder;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMapper;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.session.enums.SessionType;
import java.util.Map;
import org.springframework.stereotype.Service;

/** 从工作组事实所在库判断占名，不修改或删除历史项目。 */
@Service
public class WorkgroupNameService {
    private final TenantNodeClient node;
    private final ByaiSessionMapper sessions;

    public WorkgroupNameService(TenantNodeClient node, ByaiSessionMapper sessions) {
        this.node = node;
        this.sessions = sessions;
    }

    public boolean exists(String name, Long creatorId, Long enterpriseId) {
        var tenant = TenantRequestContextHolder.get();
        if (tenant != null && !RuntimeEnvironment.isDevelopment()) {
            if (!Long.valueOf(tenant.userId()).equals(creatorId)
                || !Long.valueOf(tenant.enterpriseId()).equals(enterpriseId)) {
                throw new IllegalArgumentException("Workgroup name scope does not match tenant context");
            }
            NameCheck result = node.request(tenant, "POST", "/internal/v1/group-chats/name-check",
                Map.of("name", name), new TypeReference<NameCheck>() { });
            if (result == null || result.exists() == null) {
                throw new IllegalStateException("Tenant workgroup name check unavailable");
            }
            return result.exists();
        }
        long tenantId = enterpriseId == null ? 1L : enterpriseId;
        LambdaQueryWrapper<ByaiSession> query = new LambdaQueryWrapper<>();
        query.eq(ByaiSession::getCreatorId, creatorId)
            .eq(ByaiSession::getSessionName, name)
            .eq(ByaiSession::getSessionType, SessionType.HS_AS.getCode())
            .and(scope -> {
                scope.eq(ByaiSession::getEnterpriseId, tenantId);
                if (tenantId == 1L) scope.or().isNull(ByaiSession::getEnterpriseId);
            })
            .and(state -> state.ne(ByaiSession::getState, GroupChatAuthorizationService.DISSOLVED_STATE)
                .or().isNull(ByaiSession::getState));
        Long count = sessions.selectCount(query);
        return count != null && count > 0;
    }

    public record NameCheck(Boolean exists) { }
}
