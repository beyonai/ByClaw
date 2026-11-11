package com.iwhalecloud.byai.state.interfaces.controller.groupchat;

import java.util.Map;

import com.iwhalecloud.byai.common.integration.security.InternalServicePrincipal;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.domain.groupchat.integration.WorkgroupMessageAccessService;
import com.iwhalecloud.byai.state.domain.groupchat.integration.WorkgroupMessageQuery;
import com.iwhalecloud.byai.state.domain.groupchat.integration.WorkgroupUnreadService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.constraints.Min;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Read-only chat facts for explicitly authorized services; browser identities cannot impersonate a recipient. */
@Validated
@RestController
@RequestMapping("/internal/v1/tenants/{enterpriseId}")
public class WorkgroupIntegrationController {
    private final WorkgroupMessageAccessService access;
    private final WorkgroupUnreadService unread;

    public WorkgroupIntegrationController(WorkgroupMessageAccessService access, WorkgroupUnreadService unread) {
        this.access = access;
        this.unread = unread;
    }

    @GetMapping("/workgroups/{groupId}/members/{accountId}")
    public ResponseUtil<?> member(HttpServletRequest request, @PathVariable @Min(1) long enterpriseId,
        @PathVariable @Min(1) long groupId, @PathVariable @Min(1) long accountId) {
        authorize(request, enterpriseId);
        return ResponseUtil.success(Map.of("member", access.member(enterpriseId, groupId, accountId)));
    }

    @GetMapping("/workgroups/{groupId}/messages/{messageId}/access/{accountId}")
    public ResponseUtil<?> messageAccess(HttpServletRequest request, @PathVariable @Min(1) long enterpriseId,
        @PathVariable @Min(1) long groupId, @PathVariable @Min(1) long messageId,
        @PathVariable @Min(1) long accountId,
        @RequestParam(name = "includePreview", defaultValue = "false") boolean includePreview) {
        authorize(request, enterpriseId);
        WorkgroupMessageQuery query = new WorkgroupMessageQuery(enterpriseId, groupId, messageId, accountId);
        // 摘要是显式请求的附加读取，沿用相同服务 scope、企业和接收人权限。
        if (includePreview) {
            var preview = access.preview(query);
            return ResponseUtil.success(preview == null ? Map.of("allowed", false, "mentioned", false)
                : Map.of("allowed", true, "mentioned", access.mentioned(query), "preview", preview));
        }
        boolean allowed = access.allowed(query);
        return ResponseUtil.success(Map.of("allowed", allowed, "mentioned", allowed && access.mentioned(query)));
    }

    @GetMapping("/accounts/{accountId}/workgroup-unread")
    public ResponseUtil<?> unread(HttpServletRequest request, @PathVariable @Min(1) long enterpriseId,
        @PathVariable @Min(1) long accountId) {
        authorize(request, enterpriseId);
        return ResponseUtil.success(Map.of("count", unread.count(accountId, enterpriseId)));
    }

    private void authorize(HttpServletRequest request, long enterpriseId) {
        InternalServicePrincipal principal = InternalServicePrincipal.require(request);
        principal.requireScope("workgroup:read");
        principal.requireTenant(Long.toString(enterpriseId));
    }
}
