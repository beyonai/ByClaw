package com.iwhalecloud.byai.state.domain.groupchat.application;

import java.io.OutputStream;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxUserContextRunner;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeClient;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.GroupDispatch;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.GroupTaskClaim;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.GroupTaskUpdate;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContext;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContextHolder;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.service.AssistantChatService;

/** Runs tenant group mentions in private tenant task sessions. Node owns all message writes. */
@Service
public class TenantGroupAgentDispatcher {
    @org.springframework.beans.factory.annotation.Autowired
    private com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher events;
    private static final Logger log = LoggerFactory.getLogger(TenantGroupAgentDispatcher.class);
    private final ExecutorService workers = new ThreadPoolExecutor(4, 4, 0L, TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<>(128));
    private final UserService users;
    private final SandboxUserContextRunner userContext;
    private final AssistantChatService chat;
    private final TenantNodeClient node;

    public TenantGroupAgentDispatcher(UserService users, SandboxUserContextRunner userContext,
        AssistantChatService chat, TenantNodeClient node) {
        this.users = users;
        this.userContext = userContext;
        this.chat = chat;
        this.node = node;
    }

    public void dispatch(TenantRequestContext tenant, Long groupId, String sourceMessageId,
        String content, List<GroupDispatch> dispatches) {
        if (dispatches == null) return;
        for (GroupDispatch dispatch : dispatches) {
            try {
                workers.execute(() -> execute(tenant, groupId, sourceMessageId, content, dispatch));
            }
            catch (RejectedExecutionException error) {
                log.error("租户群任务队列已满, groupId={}, taskId={}", groupId, dispatch.taskSessionId(), error);
            }
        }
    }

    private void execute(TenantRequestContext tenant, Long groupId, String sourceMessageId,
        String content, GroupDispatch dispatch) {
        TenantRequestContextHolder.set(tenant);
        boolean claimed = false;
        try {
            claimed = Boolean.TRUE.equals(node.command(tenant, "POST",
                "/internal/v1/group-chats/" + groupId + "/tasks/" + dispatch.taskSessionId() + "/claim",
                groupId.toString(), "CLAIM_TASK", new GroupTaskClaim(dispatch.taskSessionId())).claimed());
            if (!claimed) return;
            Users user = users.findById(tenant.userId());
            if (user == null || user.getUserCode() == null) {
                throw new IllegalStateException("group task initiator unavailable");
            }
            userContext.runAsUser(user.getUserCode(), () -> {
                CurrentUserHolder.getLoginInfo().setEnterpriseId(tenant.enterpriseId());
                CurrentUserHolder.getLoginInfo().setComAcctId(tenant.enterpriseId());
                AssistantChatDto request = new AssistantChatDto();
                request.setSessionId(Long.valueOf(dispatch.taskSessionId()));
                request.setAgentId(Long.valueOf(dispatch.targetAgentId()));
                request.setAgentType("001");
                request.setChatContent(content);
                request.setClientRequestId("group-" + sourceMessageId + "-" + dispatch.targetAgentId());
                Map<String, Object> params = new java.util.HashMap<>();
                params.put("tenantGroupTask", dispatch.taskSessionId());
                if (dispatch.groupCoordination() != null) params.put("groupCoordination", dispatch.groupCoordination());
                request.setExtParams(params);
                try {
                    chat.chat(request, OutputStream.nullOutputStream(), null);
                }
                catch (java.io.IOException error) {
                    throw new IllegalStateException("Unable to execute tenant group agent", error);
                }
            });
            // The terminal mirror projects the reply into the group in the same tenant transaction.
            Map<String, Object> state = node.request(tenant, "GET",
                "/internal/v1/group-chat/tasks/" + dispatch.taskSessionId(), null,
                new TypeReference<Map<String, Object>>() { });
            if (!"WAITING_USER".equals(state.get("turnStatus"))
                && !"FAILED".equals(state.get("turnStatus"))) {
                throw new IllegalStateException("Group agent returned without a terminal tenant mirror");
            }
            if (dispatch.groupCoordination() != null && "COORDINATED".equals(dispatch.groupCoordination().get("mode"))) {
                com.alibaba.fastjson.JSONObject status = new com.alibaba.fastjson.JSONObject();
                status.put("type", "GROUP_CHAT_EVENT");
                status.put("event", "TASK_STATUS_CHANGED");
                status.put("sessionId", groupId.toString());
                status.put("taskId", dispatch.taskSessionId());
                status.put("sourceMessageId", sourceMessageId);
                status.put("targetAgentId", dispatch.targetAgentId());
                status.put("status", state.get("status"));
                status.put("turnStatus", state.get("turnStatus"));
                status.put("groupCoordination", dispatch.groupCoordination());
                events.publishTenant(tenant, groupId, status);
            }
        }
        catch (Exception error) {
            log.error("租户群任务执行失败, groupId={}, taskId={}", groupId, dispatch.taskSessionId(), error);
            if (claimed) {
                try {
                    node.command(tenant, "PATCH", "/internal/v1/group-chats/" + groupId + "/tasks/"
                        + dispatch.taskSessionId(), groupId.toString(), "UPDATE_TASK",
                        new GroupTaskUpdate(dispatch.taskSessionId(), "ACTIVE", "FAILED"),
                        "group-task-failed-" + dispatch.taskSessionId());
                }
                catch (Exception updateError) {
                    log.error("租户群任务失败状态写入失败, taskId={}", dispatch.taskSessionId(), updateError);
                }
            }
        }
        finally {
            TenantRequestContextHolder.clear();
        }
    }

    @PreDestroy
    public void close() {
        workers.shutdown();
    }
}
