package com.iwhalecloud.byai.state.domain.groupchat.application;

import com.iwhalecloud.byai.common.i18n.I18nUtil;

import java.io.ByteArrayOutputStream;
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
import org.springframework.beans.factory.annotation.Autowired;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatResponseNotifier;

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
    private static final Logger log = LoggerFactory.getLogger(TenantGroupAgentDispatcher.class);
    private final ExecutorService workers = new ThreadPoolExecutor(4, 4, 0L, TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<>(128));
    @Autowired
    private GroupChatResponseNotifier responseNotifier;

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
        if (dispatches == null) {
            return;
        }
        for (GroupDispatch dispatch : dispatches) {
            try {
                workers.execute(() -> execute(tenant, groupId, sourceMessageId, content, dispatch));
            }
            catch (RejectedExecutionException error) {
                log.error("租户群任务队列已满, groupId={}, taskId={}", groupId, dispatch.taskSessionId(), error);
                failDispatch(tenant, groupId, dispatch);
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
            if (!claimed) {
                return;
            }
            notifyResponse(tenant, groupId, dispatch);
            Users user = users.findById(tenant.userId());
            if (user == null || user.getUserCode() == null) {
                throw new IllegalStateException(I18nUtil.get("groupchat.task.initiatorUnavailable"));
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
                if (dispatch.groupCoordination() != null) {
                    params.put("groupCoordination", dispatch.groupCoordination());
                }
                request.setExtParams(params);
                try {
                    chat.chat(request, new DiscardingResponseStream(), null);
                }
                catch (java.io.IOException error) {
                    log.error("租户群响应启动失败, taskId={}", dispatch.taskSessionId(), error);
                    throw new IllegalStateException(I18nUtil.get("groupchat.task.executeFailed"), error);
                }
            });
            // Gateway dispatch may return before the Redis Stream delivers the final answer.
            // The terminal mirror owns task completion and group publication, including async turns.
        }
        catch (Exception error) {
            log.error("租户群任务执行失败, groupId={}, taskId={}", groupId, dispatch.taskSessionId(), error);
            if (claimed) {
                failDispatch(tenant, groupId, dispatch);
            }
        }
        finally {
            TenantRequestContextHolder.clear();
        }
    }

    /** 队列拒绝与运行启动失败都必须结束候选响应，避免群内永久等待。 */
    private void failDispatch(TenantRequestContext tenant, Long groupId, GroupDispatch dispatch) {
        try {
            node.command(tenant, "PATCH", "/internal/v1/group-chats/" + groupId + "/tasks/"
                + dispatch.taskSessionId(), groupId.toString(), "UPDATE_TASK",
                new GroupTaskUpdate(dispatch.taskSessionId(), "ACTIVE", "FAILED"),
                "group-task-failed-" + dispatch.taskSessionId());
            notifyResponse(tenant, groupId, dispatch);
        }
        catch (Exception error) {
            log.error("租户群响应失败状态写入失败, taskId={}", dispatch.taskSessionId(), error);
        }
    }

    /** Node 状态提交后同步群响应视图，直接协调任务复用 task 身份。 */
    private void notifyResponse(TenantRequestContext tenant, Long groupId, GroupDispatch dispatch) {
        if (dispatch.dispatchId() != null) {
            String prefix = dispatch.groupCoordination() != null
                && "COORDINATED".equals(dispatch.groupCoordination().get("mode")) ? "task:" : "execution:";
            responseNotifier.changed(groupId, prefix + dispatch.dispatchId(), tenant.userId(), tenant);
        }
    }

    @PreDestroy
    public void close() {
        workers.shutdown();
    }

    /** CompletionsUtils requires this stream type; tenant replies are persisted by Node, not buffered here. */
    private static final class DiscardingResponseStream extends ByteArrayOutputStream {
        private DiscardingResponseStream() {
            super(0);
        }

        @Override
        public void write(int value) {
        }

        @Override
        public void write(byte[] bytes, int offset, int length) {
        }
    }
}
