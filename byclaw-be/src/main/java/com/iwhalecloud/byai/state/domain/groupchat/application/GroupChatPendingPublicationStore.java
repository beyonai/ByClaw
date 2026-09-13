package com.iwhalecloud.byai.state.domain.groupchat.application;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatPendingPublication;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatPendingPublicationMapper;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatPendingPublicationResponse;
import com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService;

/** 待发布记录和私有通知；上传进度独立提交，避免发布回滚导致重复上传。 */
@Service
public class GroupChatPendingPublicationStore {
    private final ByaiGroupChatPendingPublicationMapper mapper;
    private final MultiDeviceBroadcastService broadcaster;

    public GroupChatPendingPublicationStore(ByaiGroupChatPendingPublicationMapper mapper,
        MultiDeviceBroadcastService broadcaster) {
        this.mapper = mapper;
        this.broadcaster = broadcaster;
    }

    public ByaiGroupChatPendingPublication find(Long taskId) {
        return mapper.selectById(taskId);
    }

    public void replace(ByaiGroupChatTask task, ByaiGroupChatPendingPublication pending) {
        mapper.deleteById(task.getTaskSessionId());
        mapper.insert(pending);
        notifyAfterCommit(task, "TASK_PUBLICATION_PREPARED", pending, null);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void checkpoint(Long id, Long cloudResourceId, String json) {
        if (mapper.checkpoint(id, cloudResourceId, json) != 1) {
            throw new IllegalStateException("Pending publication changed during upload");
        }
    }

    public void clear(ByaiGroupChatTask task, Long messageId) {
        ByaiGroupChatPendingPublication pending = find(task.getTaskSessionId());
        if (pending != null) {
            mapper.deleteById(task.getTaskSessionId());
            notifyAfterCommit(task, "TASK_PUBLICATION_CLEARED", pending, messageId);
        }
    }

    public GroupChatPendingPublicationResponse response(ByaiGroupChatPendingPublication pending) {
        if (pending == null) {
            return null;
        }
        GroupChatPendingPublicationResponse response = new GroupChatPendingPublicationResponse();
        response.setTaskId(pending.getTaskSessionId());
        response.setPendingPublicationId(pending.getPendingPublicationId());
        response.setText(pending.getTextContent());
        response.setSourcePaths(JSON.parseArray(pending.getSourceFilesJson(), String.class));
        response.setCreateTime(pending.getCreateTime());
        return response;
    }

    private void notifyAfterCommit(ByaiGroupChatTask task, String type,
        ByaiGroupChatPendingPublication pending, Long messageId) {
        JSONObject event = new JSONObject();
        event.put("type", "GROUP_CHAT_TASK_EVENT");
        event.put("event", type);
        event.put("sessionId", String.valueOf(task.getTaskSessionId()));
        event.put("taskId", String.valueOf(task.getTaskSessionId()));
        event.put("pendingPublicationId", String.valueOf(pending.getPendingPublicationId()));
        if ("TASK_PUBLICATION_PREPARED".equals(type)) {
            event.put("text", pending.getTextContent());
            event.put("sourcePaths", JSON.parseArray(pending.getSourceFilesJson(), String.class));
        }
        if (messageId != null) {
            event.put("messageId", String.valueOf(messageId));
        }
        Runnable send = () -> broadcaster.broadcastRawToUser(task.getInitiatorUserId(), event, null);
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    send.run();
                }
            });
        } else {
            send.run();
        }
    }
}
