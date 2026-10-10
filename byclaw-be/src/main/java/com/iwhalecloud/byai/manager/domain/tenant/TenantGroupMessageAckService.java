package com.iwhalecloud.byai.manager.domain.tenant;

import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MessageAcknowledgementPayload;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import org.springframework.stereotype.Service;

/** Node 校验并提交确认记录后，BE 复用群事件广播；不读写共享群消息表。 */
@Service
public class TenantGroupMessageAckService {
    private final TenantNodeClient node;
    private final GroupChatEventPublisher events;

    public TenantGroupMessageAckService(TenantNodeClient node, GroupChatEventPublisher events) {
        this.node = node;
        this.events = events;
    }

    public JSONObject change(TenantRequestContext context, Long sessionId, Long messageId, boolean acknowledge) {
        var login = CurrentUserHolder.getLoginInfo();
        String userName = login != null && Long.valueOf(context.userId()).equals(login.getUserId())
            ? login.getUserName() : null;
        var result = node.command(context, acknowledge ? "POST" : "DELETE",
            "/internal/v1/group-chats/" + sessionId + "/messages/" + messageId + "/ack",
            sessionId.toString(), acknowledge ? "ACK_MESSAGE" : "UNACK_MESSAGE",
            new MessageAcknowledgementPayload(messageId.toString(), userName));
        if (result.acknowledgements() == null) {
            throw new IllegalStateException("tenant message acknowledgements unavailable");
        }
        JSONObject event = new JSONObject();
        event.put("type", "GROUP_CHAT_EVENT");
        event.put("event", "MESSAGE_ACK_UPDATED");
        event.put("sessionId", sessionId.toString());
        event.put("messageId", messageId.toString());
        JSONArray acknowledgements = new JSONArray();
        for (var ack : result.acknowledgements()) {
            JSONObject item = new JSONObject();
            item.put("messageId", ack.messageId());
            item.put("userId", ack.userId());
            item.put("userName", ack.userName());
            item.put("acknowledgedAt", ack.acknowledgedAt());
            acknowledgements.add(item);
            if (acknowledge && Long.toString(context.userId()).equals(ack.userId())) {
                event.put("acknowledgedBy", item);
            }
        }
        event.put("acknowledgements", acknowledgements);
        events.publishTenant(context, sessionId, event);
        return event;
    }
}
