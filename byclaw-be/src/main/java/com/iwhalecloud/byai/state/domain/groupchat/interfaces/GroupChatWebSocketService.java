package com.iwhalecloud.byai.state.domain.groupchat.interfaces;

import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatApplicationService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatActiveTaskException;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatMessageRejectedException;
import com.iwhalecloud.byai.state.domain.ws.model.ChatMessage;

import io.netty.channel.ChannelHandlerContext;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;
import lombok.extern.slf4j.Slf4j;

/** 群聊 WebSocket 命令适配器；业务编排仍由应用服务负责。 */
@Slf4j
@Service
public class GroupChatWebSocketService {
    private final GroupChatApplicationService applicationService;

    public GroupChatWebSocketService(GroupChatApplicationService applicationService) {
        this.applicationService = applicationService;
    }

    public void send(ChannelHandlerContext context, ChatMessage message) {
        JSONObject response;
        if (message.getSessionId() == null || (message.getChatContent() == null
            && (message.getFiles() == null || message.getFiles().isEmpty()))) {
            // 缺少群 ID 时，FE 只能通过 ERROR 的 clientRequestId 结束该请求的等待。
            response = failure(message, message.getSessionId() == null ? "ERROR" : "GROUP_CHAT_REJECTED",
                "INVALID_GROUP_MESSAGE", "Group chat session and content are required");
        }
        else {
            // 纯附件请求允许省略正文，统一为空字符串以保持持久化与广播的正文结构一致。
            if (message.getChatContent() == null) {
                message.setChatContent("");
            }
            response = accept(message);
        }
        // 写回发生在业务异常边界之外，避免把 ACK 写入失败误报成消息拒绝。
        context.writeAndFlush(new TextWebSocketFrame(JSON.toJSONString(response)));
    }

    private JSONObject accept(ChatMessage message) {
        try {
            Long messageId = applicationService.acceptUserMessage(message);
            JSONObject ack = event(message, "GROUP_CHAT_ACCEPTED");
            ack.put("messageId", messageId);
            return ack;
        }
        catch (GroupChatActiveTaskException rejection) {
            // 事务已回滚，保留活动任务入口信息和原有错误码。
            JSONObject response = failure(message, "GROUP_CHAT_REJECTED",
                GroupChatActiveTaskException.CODE, rejection.getMessage());
            response.put("taskId", String.valueOf(rejection.getTaskId()));
            response.put("agentId", String.valueOf(rejection.getAgentId()));
            return response;
        }
        catch (GroupChatMessageRejectedException rejection) {
            return failure(message, "GROUP_CHAT_REJECTED", "GROUP_CHAT_VALIDATION_FAILED", rejection.getMessage());
        }
        catch (Exception error) {
            // 提交结果或提交后广播可能不确定；ERROR 允许原请求重试和迟到的 ACK 校正。
            log.error("Group message processing failed, sessionId={}, clientRequestId={}",
                message.getSessionId(), message.getClientRequestId(), error);
            boolean storageFailure = error instanceof DataAccessException;
            return failure(message, "ERROR", storageFailure ? "GROUP_CHAT_STORAGE_ERROR" : "GROUP_CHAT_INTERNAL_ERROR",
                storageFailure ? "数据库处理失败，消息发送结果暂未确认，请稍后重试"
                    : "服务处理异常，消息发送结果暂未确认，请稍后重试");
        }
    }

    private JSONObject event(ChatMessage message, String type) {
        JSONObject response = new JSONObject();
        response.put("type", type);
        if (message.getSessionId() != null) {
            response.put("sessionId", String.valueOf(message.getSessionId()));
        }
        response.put("clientRequestId", message.getClientRequestId());
        return response;
    }

    private JSONObject failure(ChatMessage message, String type, String code, String reason) {
        JSONObject response = event(message, type);
        response.put("code", code);
        response.put("message", reason == null || reason.isBlank() ? "消息发送被拒绝" : reason);
        return response;
    }
}
