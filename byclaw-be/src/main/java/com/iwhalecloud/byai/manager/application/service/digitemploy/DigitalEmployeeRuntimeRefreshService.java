package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.iwhalecloud.byai.manager.application.service.digitemploy.event.DigEmployeeChangeEventPublisher;
import com.iwhalecloud.byai.manager.application.service.digitemploy.event.DigEmployeeChangeEventType;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDTO;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * 在资源和关联关系事务提交后，统一刷新数字员工运行态并发布 Redis Pub/Sub 事件。
 *
 * @author qin.guoquan
 * @date 2026-07-20 20:38:38
 */
@Service
public class DigitalEmployeeRuntimeRefreshService {

    private static final Logger logger = LoggerFactory.getLogger(DigitalEmployeeRuntimeRefreshService.class);

    private static final Object TRANSACTION_REFRESH_REQUESTS_KEY = new Object();

    private static final String SOURCE_SKILL_RUNTIME_REFRESH = "skill-runtime-refresh";

    private static final String SOURCE_MANAGER_API = "manager-api";

    @Autowired
    private DigitalEmployeePostCommitRefreshExecutor postCommitRefreshExecutor;

    @Autowired
    private DigEmployeeChangeEventPublisher digEmployeeChangeEventPublisher;

    public void scheduleSkillRuntimeRefreshAfterCommit(Collection<Long> digitalEmployeeIds) {
        if (digitalEmployeeIds == null) {
            return;
        }
        for (Long digitalEmployeeId : digitalEmployeeIds) {
            scheduleAfterCommit(new RuntimeRefreshRequest(digitalEmployeeId, null,
                DigEmployeeChangeEventType.DIG_EMPLOYEE_SKILLS_SYNCED, SOURCE_SKILL_RUNTIME_REFRESH));
        }
    }

    public void scheduleDigitalEmployeeUpdateRefreshAfterCommit(Long digitalEmployeeId, DigitalEmployeeDTO inputDto) {
        scheduleAfterCommit(new RuntimeRefreshRequest(digitalEmployeeId, inputDto,
            DigEmployeeChangeEventType.DIG_EMPLOYEE_UPDATED, SOURCE_MANAGER_API));
    }

    @SuppressWarnings("unchecked")
    private void scheduleAfterCommit(RuntimeRefreshRequest request) {
        if (request.digitalEmployeeId() == null) {
            return;
        }
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            refreshNow(request);
            return;
        }

        Map<Long, RuntimeRefreshRequest> requests = (Map<Long, RuntimeRefreshRequest>)TransactionSynchronizationManager
            .getResource(TRANSACTION_REFRESH_REQUESTS_KEY);
        if (requests == null) {
            requests = new LinkedHashMap<>();
            TransactionSynchronizationManager.bindResource(TRANSACTION_REFRESH_REQUESTS_KEY, requests);
            Map<Long, RuntimeRefreshRequest> registeredRequests = requests;
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    registeredRequests.values().forEach(DigitalEmployeeRuntimeRefreshService.this::refreshNow);
                }

                @Override
                public void afterCompletion(int status) {
                    if (TransactionSynchronizationManager.hasResource(TRANSACTION_REFRESH_REQUESTS_KEY)) {
                        TransactionSynchronizationManager.unbindResource(TRANSACTION_REFRESH_REQUESTS_KEY);
                    }
                }
            });
        }
        requests.merge(request.digitalEmployeeId(), request, DigitalEmployeeRuntimeRefreshService::mergeRequest);
    }

    private void refreshNow(RuntimeRefreshRequest request) {
        Long digitalEmployeeId = request.digitalEmployeeId();
        try {
            boolean redisSyncSucceeded = postCommitRefreshExecutor.refresh(digitalEmployeeId, request.inputDto());
            if (!redisSyncSucceeded) {
                if (request.eventType() == DigEmployeeChangeEventType.DIG_EMPLOYEE_SKILLS_SYNCED) {
                    logger.warn("数字员工技能运行态刷新未完成，跳过技能变更通知, digitalEmployeeId={}", digitalEmployeeId);
                    return;
                }
                // 数字员工编辑原本在事务提交后始终发送 UPDATED；同步失败时保留这一既有事件语义，
                // 避免影响权限刷新及其他订阅方，同时日志明确记录快照同步异常。
                logger.warn("数字员工运行态刷新未完成，继续发送原有更新通知, digitalEmployeeId={}, eventType={}",
                    digitalEmployeeId, request.eventType());
            }
            digEmployeeChangeEventPublisher.publishNowQuietly(request.eventType(), digitalEmployeeId, request.source());
        }
        catch (Exception e) {
            logger.error("数字员工运行态刷新失败，跳过变更通知, digitalEmployeeId={}, eventType={}, reason={}", digitalEmployeeId,
                request.eventType(), e.getMessage(), e);
        }
    }

    private static RuntimeRefreshRequest mergeRequest(RuntimeRefreshRequest existing, RuntimeRefreshRequest incoming) {
        DigitalEmployeeDTO inputDto = incoming.inputDto() == null ? existing.inputDto() : incoming.inputDto();
        DigEmployeeChangeEventType eventType = Objects.equals(incoming.eventType(),
            DigEmployeeChangeEventType.DIG_EMPLOYEE_SKILLS_SYNCED) ? incoming.eventType() : existing.eventType();
        String source = eventType == DigEmployeeChangeEventType.DIG_EMPLOYEE_SKILLS_SYNCED
            ? SOURCE_SKILL_RUNTIME_REFRESH : incoming.source();
        return new RuntimeRefreshRequest(existing.digitalEmployeeId(), inputDto, eventType, source);
    }

    private record RuntimeRefreshRequest(Long digitalEmployeeId, DigitalEmployeeDTO inputDto,
        DigEmployeeChangeEventType eventType, String source) {
    }
}
