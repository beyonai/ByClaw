package com.iwhalecloud.byai.manager.domain.tenant;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.HandlerInterceptor;

import com.iwhalecloud.byai.common.integration.security.InternalServicePrincipal;

/** Validates the tenant selector against current login and membership. */
@Component
public class TenantContextInterceptor implements HandlerInterceptor {

    private static final java.util.Set<String> CHAT_ROUTES = java.util.Set.of(
        "/chat/superAgentChat", "/chat/runningStatus", "/chat/runningSnapshot", "/chat/stopChat",
        "/chat/getMessageById", "/chat/updateMessageStructById", "/chat/sessionStatus",
        "/chat/getTraceIdByMessageId");

    private final TenantContextService tenantContextService;

    public TenantContextInterceptor(TenantContextService tenantContextService) {
        this.tenantContextService = tenantContextService;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        TenantRequestContextHolder.clear();
        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
            return true;
        }
        String path = request.getRequestURI().substring(request.getContextPath().length());
        String enterpriseId = request.getHeader("X-Enterprise-Id");
        InternalServicePrincipal servicePrincipal = (InternalServicePrincipal) request.getAttribute(
            InternalServicePrincipal.ATTRIBUTE);

        if (request.getHeader("X-Tenant-Context") != null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "tenant.context.header.removed");
        }

        // Internal routes use their signed service principal and their own scope/object checks.
        // A browser selector must never expand that authority; if supplied, it is checked against
        // the principal's allow-list before the internal controller handles the request.
        if (servicePrincipal != null) {
            if (enterpriseId != null) {
                servicePrincipal.requireTenant(enterpriseId);
            }
            return true;
        }

        if (enterpriseId == null) {
            return true;
        }

        // 云盘存储位于平台，复制按两端资源独立鉴权；工作组租户仍须通过当前用户成员关系验证。
        boolean knowledgeFileCopy = "POST".equalsIgnoreCase(request.getMethod())
            && "/datasetController/copyKnowledgeFile".equals(path);
        if (!path.startsWith("/tenantContext/") && !path.startsWith("/assiman/")
            && !knowledgeFileCopy
            && !"/api/v1/sessionResources/query".equals(path)
            && !"/project/session/listByQo".equals(path)
            && !"/showcase/messages/count".equals(path)
            && !"/api/v2/digitEmploy/queryMyCreatedAndSubscribedAgents".equals(path)
            && !path.equals("/group-chats") && !path.startsWith("/group-chats/")
            && !path.startsWith("/group-chat/tasks/")
            && !CHAT_ROUTES.contains(path)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant.route.notReady");
        }
        TenantRequestContextHolder.set(tenantContextService.validate(enterpriseId));
        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler,
                                Exception ex) {
        TenantRequestContextHolder.clear();
    }
}
