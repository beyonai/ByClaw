package com.iwhalecloud.byai.manager.domain.tenant;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxUserContextRunner;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTaskService;
import org.springframework.stereotype.Service;

/** Node 已授权取消；管理员代停时仍使用任务发起人的沙箱与租户上下文。 */
@Service
public class TenantGroupTaskStopService {
    private final GroupChatTaskService tasks;
    private final UserService users;
    private final SandboxUserContextRunner context;
    private final ObjectMapper mapper;

    public TenantGroupTaskStopService(GroupChatTaskService tasks, UserService users,
        SandboxUserContextRunner context, ObjectMapper mapper) {
        this.tasks = tasks;
        this.users = users;
        this.context = context;
        this.mapper = mapper;
    }

    public void stop(TenantRequestContext tenant, JsonNode row) {
        ByaiGroupChatTask task = mapper.convertValue(row, ByaiGroupChatTask.class);
        if (!"RUNNING".equals(task.getTurnStatus())) return;
        var user = users.findById(task.getInitiatorUserId());
        if (user == null || user.getUserCode() == null) throw new IllegalStateException("Task initiator unavailable");
        TenantRequestContext previous = TenantRequestContextHolder.get();
        try {
            TenantRequestContextHolder.set(new TenantRequestContext(task.getInitiatorUserId(), tenant.enterpriseId(), "MEMBER"));
            context.runAsUser(user.getUserCode(), () -> {
                CurrentUserHolder.getLoginInfo().setEnterpriseId(tenant.enterpriseId());
                CurrentUserHolder.getLoginInfo().setComAcctId(tenant.enterpriseId());
                tasks.stopTenantTask(task);
            });
        } finally {
            if (previous == null) TenantRequestContextHolder.clear(); else TenantRequestContextHolder.set(previous);
        }
    }
}
