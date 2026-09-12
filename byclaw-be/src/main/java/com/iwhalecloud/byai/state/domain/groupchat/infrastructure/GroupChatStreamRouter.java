package com.iwhalecloud.byai.state.domain.groupchat.infrastructure;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatExecution;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatExecutionMapper;

/** 群委派分类和完成投影的补偿观察器；子会话 Stream 由统一 SessionStreamManager 消费。 */
@Service
public class GroupChatStreamRouter {
    private static final Logger log = LoggerFactory.getLogger(GroupChatStreamRouter.class);
    private final ByaiGroupChatExecutionMapper executionMapper;
    private final GroupChatExecutionEventHandler eventHandler;

    public GroupChatStreamRouter(ByaiGroupChatExecutionMapper executionMapper,
        GroupChatExecutionEventHandler eventHandler) {
        this.executionMapper = executionMapper;
        this.eventHandler = eventHandler;
    }

    @Scheduled(fixedDelayString = "${byclaw.group-chat.stream-poll-ms:500}")
    public void pollRunningExecutions() {
        for (ByaiGroupChatExecution execution : executionMapper.selectRunningExecutions()) {
            try {
                eventHandler.reconcile(execution.getCandidateSessionId());
            }
            catch (RuntimeException error) {
                // 单个 Agent 的观察失败不得阻塞同一群内其他独立任务，下一轮按持久化状态重试。
                log.warn("Group execution reconciliation failed: executionId={}", execution.getExecutionId(), error);
            }
        }
    }
}
