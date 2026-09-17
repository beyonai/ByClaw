package com.iwhalecloud.byai.state.domain.groupchat.application;

import java.io.IOException;
import java.io.InputStream;
import java.util.List;
import java.util.Objects;

import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatTaskAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatTaskDeliverySignal;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatTaskDeliveryResponse;

/** 按当前发起人的 UserFS 查询交付信号，不维护轮次、执行 Agent 或成果有效期。 */
@Service
public class GroupChatTaskDeliveryService {
    private static final int MAX_BYTES = 16 * 1024;
    private final GroupChatTaskAuthorizationService authorization;
    private final UserFS userFS;
    private final ObjectMapper objectMapper;

    public GroupChatTaskDeliveryService(GroupChatTaskAuthorizationService authorization, UserFS userFS,
        ObjectMapper objectMapper) {
        this.authorization = authorization;
        this.userFS = userFS;
        this.objectMapper = objectMapper;
    }

    public GroupChatTaskDeliveryResponse current(Long taskId) {
        String path = GroupChatTaskDeliverySignal.storagePath(taskId);
        // 先核验任务发起人和当前群成员资格，再使用登录上下文中的用户空间。
        authorization.requireInitiator(taskId);
        byte[] bytes;
        try {
            String directory = path.substring(0, path.lastIndexOf('/'));
            List<String> files = Objects.requireNonNull(userFS.list(directory, 1), "Missing storage listing");
            if (!files.contains(path) && !files.contains("/by" + path)) {
                return new GroupChatTaskDeliveryResponse(taskId.toString(), false);
            }
            try (InputStream input = Objects.requireNonNull(userFS.read(path), "Missing listed delivery signal")) {
                bytes = input.readNBytes(MAX_BYTES + 1);
            }
        }
        catch (IOException | RuntimeException error) {
            // 存储异常不能伪装成尚未交付；调用方可保留上次成功状态并重试。
            throw new IllegalStateException("交付状态读取失败，请重试", error);
        }
        return new GroupChatTaskDeliveryResponse(taskId.toString(), valid(bytes, taskId));
    }

    private boolean valid(byte[] bytes, Long taskId) {
        if (bytes.length > MAX_BYTES) {
            return false;
        }
        try {
            JsonNode signal = objectMapper.readerFor(JsonNode.class)
                .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readValue(bytes);
            return signal != null && signal.isObject()
                && signal.path("schemaVersion").isTextual()
                && GroupChatTaskDeliverySignal.SCHEMA_VERSION.equals(signal.path("schemaVersion").textValue())
                && signal.path("taskSessionId").isTextual()
                && taskId.toString().equals(signal.path("taskSessionId").textValue())
                && signal.path("delivered").isBoolean() && signal.path("delivered").booleanValue();
        }
        catch (IOException ignored) {
            // 文件可能尚在写入，或由旧 runtime 写入错误协议；只认完整有效的信号。
            return false;
        }
    }
}
