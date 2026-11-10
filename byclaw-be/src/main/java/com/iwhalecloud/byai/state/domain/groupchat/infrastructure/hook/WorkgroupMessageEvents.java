package com.iwhalecloud.byai.state.domain.groupchat.infrastructure.hook;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.hook.HookEventSchema;
import com.iwhalecloud.byai.common.hook.HookPublisher;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Committed workgroup facts shared by WebSocket and external consumers; no mobile vendor or device state. */
@Configuration(proxyBeanMethods = false)
public class WorkgroupMessageEvents {
    public static final String MESSAGE_CREATED = "workgroup.message.created";
    private final HookPublisher publisher;

    public WorkgroupMessageEvents(HookPublisher publisher) {
        this.publisher = publisher;
    }

    @Bean
    public static HookEventSchema workgroupMessageCreatedSchema() {
        return new HookEventSchema(MESSAGE_CREATED, 1, Set.of("enterpriseId", "groupId", "messageId",
            "senderId", "senderType", "recipientIds"));
    }

    /** Called only after shared-store/Node commit; never export message text, files, credentials or tokens. */
    public void committed(long enterpriseId, JSONObject event, List<Long> recipientIds) {
        if (enterpriseId <= 0 || event == null || !"MESSAGE_CREATED".equals(event.getString("event"))
            || recipientIds == null) {
            return;
        }
        String groupId = event.getString("sessionId");
        String messageId = event.getString("messageId");
        if (!identifier(groupId) || !identifier(messageId)) {
            return;
        }
        JSONObject speaker = event.getJSONObject("speaker");
        String senderType = speaker == null || speaker.getString("type") == null ? "UNKNOWN"
            : speaker.getString("type").toUpperCase(java.util.Locale.ROOT);
        if (!Set.of("USER", "AGENT", "SYSTEM").contains(senderType == null ? "" : senderType)) {
            senderType = "UNKNOWN";
        }
        String senderId = event.getString("creatorId");
        List<String> recipients = recipientIds.stream().filter(id -> id != null && id > 0)
            .distinct().map(String::valueOf).toList();
        if (recipients.isEmpty()) {
            return;
        }
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("enterpriseId", Long.toString(enterpriseId));
        data.put("groupId", groupId);
        data.put("messageId", messageId);
        data.put("senderType", senderType);
        data.put("senderId", identifier(senderId) ? senderId : "");
        data.put("recipientIds", recipients);
        publisher.publishCommitted(MESSAGE_CREATED, 1, data);
    }

    private static boolean identifier(String value) {
        return value != null && value.matches("[1-9][0-9]{0,18}")
            && (value.length() < 19 || value.compareTo(Long.toString(Long.MAX_VALUE)) <= 0);
    }
}
