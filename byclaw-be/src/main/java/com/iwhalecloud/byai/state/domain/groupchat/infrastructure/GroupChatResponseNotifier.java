package com.iwhalecloud.byai.state.domain.groupchat.infrastructure;

import java.util.List;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContext;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContextHolder;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatExecution;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTurn;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatResponseQueryService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import lombok.extern.slf4j.Slf4j;

/** 仅在业务提交后发布公共响应事实；创建者 Codex，2026-11-13。 */
@Slf4j
@Service
public class GroupChatResponseNotifier {
    @Autowired
    private GroupChatResponseQueryService queryService;

    @Autowired
    private GroupChatEventPublisher eventPublisher;

    /** 捕获调用时的可信租户身份，并在原事务成功后查询投影。 */
    public void afterCommit(ByaiGroupChatExecution execution) {
        String id = (execution instanceof ByaiGroupChatTurn ? "turn:" : "execution:") + execution.getExecutionId();
        TenantRequestContext tenant = TenantRequestContextHolder.get();
        Runnable publish = () -> changed(execution.getGroupSessionId(), id, execution.getInitiatorUserId(), tenant);
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            publish.run();
        }
        else {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    publish.run();
                }
            });
        }
    }

    /** 广播失败不改变已提交执行，客户端发现和 resolve 负责补偿。 */
    public void changed(Long groupId, String responseId, Long userId, TenantRequestContext tenant) {
        try {
            var items = queryService.resolveFor(groupId, List.of(responseId), userId, tenant).getJSONArray("items");
            for (int index = 0; index < items.size(); index++) {
                JSONObject event = items.getJSONObject(index);
                event.remove("canReadContent");
                event.remove("stream");
                event.put("type", "GROUP_CHAT_EVENT");
                event.put("event", "RESPONSE_CHANGED");
                event.put("sessionId", String.valueOf(groupId));
                if (!queryService.independent(tenant)) {
                    if (tenant != null) {
                        event.put("enterpriseId", Long.toString(tenant.enterpriseId()));
                    }
                    eventPublisher.publish(groupId, event, null);
                }
                else {
                    eventPublisher.publishTenant(tenant, groupId, event);
                }
            }
        }
        catch (Exception error) {
            log.error("群响应状态通知失败, groupId={}, responseId={}", groupId, responseId, error);
        }
    }
}
