package com.iwhalecloud.byai.state.domain.groupchat.application;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTopic;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTopicMapper;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;

/** 公开群消息归属的唯一写入入口；调用方负责已有的请求、执行或任务幂等检查。 */
@Service
public class GroupChatTopicService {
    private static final int MAX_LEGACY_CHAIN_LENGTH = 10000;
    private final ByaiMessageMapper messageMapper;
    private final ByaiGroupChatTopicMapper topicMapper;
    private final SessionService sessionService;

    public GroupChatTopicService(ByaiMessageMapper messageMapper, ByaiGroupChatTopicMapper topicMapper,
        SessionService sessionService) {
        this.messageMapper = messageMapper;
        this.topicMapper = topicMapper;
        this.sessionService = sessionService;
    }

    /** 先锁群再锁执行/任务，与用户发送和任务发布保持同一锁序。 */
    @Transactional(propagation = Propagation.MANDATORY)
    public void lockGroup(Long sessionId) {
        sessionService.lockById(sessionId);
    }

    /** 消息、历史归属补齐和话题活动索引必须随调用方事务一起提交。 */
    @Transactional(propagation = Propagation.MANDATORY)
    public void persistMessage(ByaiMessage message) {
        if (message.getMessageId() == null || message.getSessionId() == null || message.getCreateTime() == null
            || !isPublicMessage(message)) {
            throw new IllegalArgumentException("Only public group messages can belong to a topic");
        }
        lockGroup(message.getSessionId());
        Long topicId = message.getMessageRef() == null ? message.getMessageId()
            : resolveTopic(message.getSessionId(), message.getMessageRef(), message.getMessageId());
        message.setTopicId(topicId);
        if (messageMapper.insert(message) != 1) {
            throw new IllegalStateException("Group message was not inserted");
        }
        if (message.getMessageRef() != null) {
            ByaiGroupChatTopic topic = new ByaiGroupChatTopic();
            topic.setTopicId(topicId);
            topic.setRootMessageId(topicId);
            topic.setGroupSessionId(message.getSessionId());
            topic.setLastMessageId(message.getMessageId());
            topic.setLastActivityAt(message.getCreateTime());
            topic.setCreateTime(message.getCreateTime());
            topicMapper.upsert(topic);
        }
    }

    private Long resolveTopic(Long sessionId, Long parentId, Long newMessageId) {
        List<ByaiMessage> unassigned = new ArrayList<>();
        Set<Long> visited = new HashSet<>();
        visited.add(newMessageId);
        Long currentId = parentId;
        Long topicId;
        while (true) {
            if (visited.size() > MAX_LEGACY_CHAIN_LENGTH || !visited.add(currentId)) {
                throw new IllegalArgumentException("Invalid or excessively deep group reply chain");
            }
            ByaiMessage current = messageMapper.selectByMessageId(currentId);
            if (current == null || !Objects.equals(sessionId, current.getSessionId()) || !isPublicMessage(current)) {
                throw new IllegalArgumentException("Referenced group message not found");
            }
            if (current.getTopicId() != null) {
                topicId = current.getTopicId();
                break;
            }
            unassigned.add(current);
            if (current.getMessageRef() == null) {
                topicId = current.getMessageId();
                break;
            }
            currentId = current.getMessageRef();
        }
        // 验证完整未归属路径后才落库，异常链不会被部分修复或误认为新根。
        for (ByaiMessage ancestor : unassigned) {
            messageMapper.assignGroupTopic(sessionId, ancestor.getMessageId(), topicId);
        }
        return topicId;
    }

    private boolean isPublicMessage(ByaiMessage message) {
        return Integer.valueOf(1).equals(message.getUsage()) || Integer.valueOf(2).equals(message.getUsage());
    }
}
