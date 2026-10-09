package com.iwhalecloud.byai.manager.domain.tenant;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.HandlerInterceptor;

/** Validates the tenant selector against current login and membership. */
@Component
public class TenantContextInterceptor implements HandlerInterceptor {

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
        String contextToken = request.getHeader("X-Tenant-Context");
        if (enterpriseId == null) {
            if (contextToken != null) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "tenant identity required");
            }
            return true;
        }
        if (contextToken == null || contextToken.isBlank()) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "tenant context token required");
        }
        if (!path.startsWith("/tenantContext/") && !path.startsWith("/assiman/")
            && !"/project/session/listByQo".equals(path)
            && !"/api/v2/digitEmploy/queryMyCreatedAndSubscribedAgents".equals(path)
            && !path.startsWith("/group-chats")) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant route is not ready");
        }
        TenantRequestContextHolder.set(tenantContextService.validate(enterpriseId, contextToken));
        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler,
                                Exception ex) {
        TenantRequestContextHolder.clear();
    }
}
