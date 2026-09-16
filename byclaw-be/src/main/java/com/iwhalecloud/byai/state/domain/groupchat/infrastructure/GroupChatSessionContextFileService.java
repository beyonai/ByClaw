package com.iwhalecloud.byai.state.domain.groupchat.infrastructure;

import java.io.BufferedWriter;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxUserContextRunner;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextRequest;
import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextResponse;
import com.iwhalecloud.byai.state.domain.chat.service.ChatTurnPreparationException;
import com.iwhalecloud.byai.state.domain.chat.service.GroupChatContextService;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatTaskAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatMessagePreview;

/** 在发起人的私有工作区保存冻结历史；文件全部写成功之后才能附加到出站提示。 */
@Service
public class GroupChatSessionContextFileService {
    private static final int PAGE_SIZE = 200;
    private static final int MAX_MANIFEST_BYTES = 4096;
    private final UserFS userFS;
    private final SandboxUserContextRunner userContextRunner;
    private final GroupChatContextService groupContextService;
    private final GroupChatAuthorizationService groupAuthorization;
    private final GroupChatTaskAuthorizationService taskAuthorization;
    private final ByaiMessageMapper messageMapper;
    private final ObjectMapper objectMapper;
    private final Object[] locks = new Object[64];

    public GroupChatSessionContextFileService(UserFS userFS, SandboxUserContextRunner userContextRunner,
        GroupChatContextService groupContextService, GroupChatAuthorizationService groupAuthorization,
        GroupChatTaskAuthorizationService taskAuthorization, ByaiMessageMapper messageMapper, ObjectMapper objectMapper) {
        this.userFS = userFS;
        this.userContextRunner = userContextRunner;
        this.groupContextService = groupContextService;
        this.groupAuthorization = groupAuthorization;
        this.taskAuthorization = taskAuthorization;
        this.messageMapper = messageMapper;
        this.objectMapper = objectMapper;
        for (int index = 0; index < locks.length; index++) {
            locks[index] = new Object();
        }
    }

    /** 群聊派发只准备群公开历史，不读取任务会话。 */
    public ContextFile prepareGroupHistory(String userCode, GroupChatContextRequest groupRequest, String traceId,
        Long currentUserMessageId) {
        return prepare(userCode, groupRequest, traceId, currentUserMessageId, false).get(0);
    }

    /** 任务切换执行员工时提供群背景和此前任务正文，两份文件全部就绪才返回。 */
    public TaskHandoffHistory prepareTaskHandoffHistory(String userCode, GroupChatContextRequest groupRequest,
        String traceId, Long currentUserMessageId) {
        List<ContextFile> files = prepare(userCode, groupRequest, traceId, currentUserMessageId, true);
        return new TaskHandoffHistory(files.get(0), files.get(1));
    }

    /** 仅复用私有存储流程；业务入口分别表达群聊派发和任务接手。 */
    private List<ContextFile> prepare(String userCode, GroupChatContextRequest groupRequest, String traceId,
        Long currentUserMessageId, boolean includeTaskHistory) {
        try {
            if (StringUtils.isBlank(userCode) || StringUtils.isBlank(traceId) || groupRequest == null
                || groupRequest.getChildSessionId() == null || groupRequest.getChildSessionId() <= 0
                || currentUserMessageId == null || currentUserMessageId <= 0
                || groupRequest.getInitiatorUserId() == null || groupRequest.getBeforeMessageId() == null) {
                throw new IllegalArgumentException("Missing server context identity");
            }
            String identity = groupRequest.getConversationKey() + ":" + groupRequest.getChildSessionId() + ":"
                + groupRequest.getBeforeMessageId() + ":" + currentUserMessageId + ":" + traceId + ":" + includeTaskHistory;
            String turnKey = HexFormat.of().formatHex(digest().digest(identity.getBytes(StandardCharsets.UTF_8)));
            return userContextRunner.callAsUser(userCode, () -> {
                // 同轮的本机重入串行；跨实例派发仍由已有数据库 turn claim 约束。
                synchronized (locks[Math.floorMod((userCode + turnKey).hashCode(), locks.length)]) {
                    try {
                        authorize(groupRequest, includeTaskHistory);
                        return prepareCurrent(groupRequest, currentUserMessageId, includeTaskHistory, turnKey);
                    }
                    catch (Exception error) {
                        throw new ChatTurnPreparationException("历史上下文准备失败，请重试", error);
                    }
                }
            });
        }
        catch (ChatTurnPreparationException error) {
            throw error;
        }
        catch (Exception error) {
            throw new ChatTurnPreparationException("历史上下文准备失败，请重试", error);
        }
    }

    private void authorize(GroupChatContextRequest request, boolean taskHistory) {
        Long groupId = Long.valueOf(request.getConversationKey());
        groupAuthorization.requireCurrentUserMember(groupId);
        if (!Objects.equals(CurrentUserHolder.getCurrentUserId(), request.getInitiatorUserId())) {
            throw new IllegalArgumentException("Context owner does not match initiator");
        }
        if (taskHistory) {
            ByaiGroupChatTask task = taskAuthorization.requireInitiator(request.getChildSessionId());
            if (!Objects.equals(task.getGroupSessionId(), groupId)) {
                throw new IllegalArgumentException("Task does not belong to source group");
            }
        }
    }

    private List<ContextFile> prepareCurrent(GroupChatContextRequest request, Long boundary, boolean taskHistory,
        String turnKey) throws IOException {
        String directory = "/.sessions/" + request.getChildSessionId() + "/.byclaw/context/" + turnKey;
        List<ContextFile> files = new ArrayList<>();
        files.add(new ContextFile("GROUP_PUBLIC", "/by" + directory + "/group-history.json",
            request.getBeforeMessageId()));
        if (taskHistory) {
            files.add(new ContextFile("TASK_PRIVATE", "/by" + directory + "/task-history.jsonl", boundary.toString()));
        }
        String marker = directory + "/complete.json";
        // UserFS 的缺文件读取在部分后端会抛异常，用目录清单判定缺失，存储故障必须中止。
        List<String> existing = Objects.requireNonNull(userFS.list(directory, 1), "Missing storage listing");
        if (existing.contains(marker) || existing.contains("/by" + marker)) {
            verifyCompleted(marker, files);
            return List.copyOf(files);
        }
        List<FileProof> proofs = new ArrayList<>();
        for (ContextFile file : files) {
            Path temporary = Files.createTempFile("byclaw-session-context-", ".tmp");
            try {
                try (BufferedWriter writer = Files.newBufferedWriter(temporary, StandardCharsets.UTF_8)) {
                    if ("GROUP_PUBLIC".equals(file.kind())) {
                        writer.write(objectMapper.writeValueAsString(groupHistoryForExport(request)));
                    }
                    else {
                        writeTaskHistory(writer, request.getChildSessionId(), boundary);
                    }
                }
                long size = Files.size(temporary);
                String checksum;
                try (InputStream input = Files.newInputStream(temporary)) {
                    checksum = checksum(input, size);
                }
                try (InputStream input = Files.newInputStream(temporary)) {
                    Objects.requireNonNull(userFS.write(input, size, "application/json; charset=utf-8",
                        storagePath(file)), "Context upload returned no result");
                }
                proofs.add(new FileProof(size, checksum));
            }
            finally {
                Files.deleteIfExists(temporary);
            }
        }
        // 完成标记最后写入；中途残留文件永不被视为成功快照，重试会安全覆盖。
        byte[] manifest = objectMapper.writeValueAsBytes(proofs);
        try (InputStream input = new ByteArrayInputStream(manifest)) {
            Objects.requireNonNull(userFS.write(input, manifest.length, "application/json", marker),
                "Context completion marker returned no result");
        }
        return List.copyOf(files);
    }

    /** 只格式化文件副本，保留原群历史接口和数据库中的成员引用协议。 */
    private GroupChatContextResponse groupHistoryForExport(GroupChatContextRequest request) {
        GroupChatContextResponse snapshot = objectMapper.convertValue(Objects.requireNonNull(
            groupContextService.load(request), "Missing group snapshot"), GroupChatContextResponse.class);
        for (GroupChatContextResponse.Message message : snapshot.getMessages()) {
            message.setContent(GroupChatMessagePreview.format(message.getContent(), message.getResourceList()));
            GroupChatContextResponse.ReplyReference reply = message.getReplyTo();
            if (reply != null) {
                reply.setContent(GroupChatMessagePreview.format(reply.getContent(), reply.getResourceList()));
            }
        }
        return snapshot;
    }

    private void verifyCompleted(String marker, List<ContextFile> files) throws IOException {
        byte[] manifest;
        try (InputStream input = Objects.requireNonNull(userFS.read(marker), "Missing completion marker")) {
            manifest = input.readNBytes(MAX_MANIFEST_BYTES + 1);
        }
        if (manifest.length > MAX_MANIFEST_BYTES) {
            throw new IOException("Invalid context completion marker");
        }
        FileProof[] proofs = objectMapper.readValue(manifest, FileProof[].class);
        if (proofs.length != files.size()) {
            throw new IOException("Incomplete context snapshot");
        }
        for (int index = 0; index < files.size(); index++) {
            FileProof proof = proofs[index];
            if (proof == null || proof.size() < 0 || proof.checksum() == null) {
                throw new IOException("Invalid context proof");
            }
            try (InputStream input = Objects.requireNonNull(userFS.read(storagePath(files.get(index))),
                "Missing completed context file")) {
                if (!proof.checksum().equals(checksum(input, proof.size()))) {
                    throw new IOException("Context snapshot changed after completion");
                }
            }
        }
    }

    private void writeTaskHistory(BufferedWriter writer, Long sessionId, Long boundary) throws IOException {
        writer.write(objectMapper.writeValueAsString(Map.of("kind", "TASK_PRIVATE", "sessionId", sessionId.toString(),
            "beforeMessageId", boundary.toString())));
        writer.newLine();
        long after = 0;
        while (true) {
            List<ByaiMessage> page = Objects.requireNonNull(
                messageMapper.selectTaskHistoryPage(sessionId, boundary, after, PAGE_SIZE), "Missing history page");
            for (ByaiMessage message : page) {
                if (message.getMessageId() == null || message.getMessageId() <= after
                    || message.getMessageId() >= boundary || !Objects.equals(sessionId, message.getSessionId())
                    || !(Integer.valueOf(1).equals(message.getUsage()) || Integer.valueOf(2).equals(message.getUsage()))) {
                    throw new IOException("Invalid task history boundary or order");
                }
                after = message.getMessageId();
                if (StringUtils.isBlank(message.getMessageContent())) {
                    continue;
                }
                // 只投影正文和发言者字段，绝不序列化消息实体中的思考或工具内容。
                Map<String, Object> body = new LinkedHashMap<>();
                body.put("messageId", after + "");
                body.put("role", Integer.valueOf(1).equals(message.getUsage()) ? "user" : "assistant");
                if (Integer.valueOf(1).equals(message.getUsage())) {
                    body.put("speakerId", message.getCreatorId());
                    body.put("speakerName", message.getCreatorName());
                }
                else {
                    appendAgentIdentity(body, message.getMetadata());
                }
                body.put("createdAt", message.getCreateTime() == null ? null : message.getCreateTime().getTime());
                // 普通用户消息的成员快照在 related_resources，群来源旧记录可从 metadata 补充。
                String content = GroupChatMessagePreview.fromMetadata(message.getMessageContent(),
                    message.getRelatedResources());
                body.put("content", GroupChatMessagePreview.fromMetadata(content, message.getMetadata()));
                writer.write(objectMapper.writeValueAsString(body));
                writer.newLine();
            }
            if (page.size() < PAGE_SIZE) {
                return;
            }
        }
    }

    /** 普通回复的 creator 是发起人，resComIds 是组件身份，实际执行员工来自服务端 metadata。 */
    private void appendAgentIdentity(Map<String, Object> body, String metadata) {
        body.put("speakerId", "unknown");
        if (StringUtils.isBlank(metadata)) {
            return;
        }
        try {
            JsonNode identity = objectMapper.readTree(metadata);
            String agentId = identity == null ? null : identity.path("agentId").asText(null);
            if (agentId == null || !agentId.matches("[0-9]+")) {
                return;
            }
            body.put("speakerId", agentId);
            // 单资源名称只有与实际执行员工匹配时才能作为署名，不能沿用最初资源 A 的名称。
            if (agentId.equals(identity.path("resourceId").asText(null))) {
                String name = identity.path("resourceName").asText(null);
                if (StringUtils.isNotBlank(name)) {
                    body.put("speakerName", name);
                }
            }
        }
        catch (JsonProcessingException ignored) {
            // 旧消息缺失或损坏的身份明确保留 unknown，不能拿发起人的姓名冒充 Agent。
        }
    }

    private String storagePath(ContextFile file) {
        return file.agentPath().substring("/by".length());
    }

    private String checksum(InputStream input, long expectedSize) throws IOException {
        MessageDigest digest = digest();
        byte[] buffer = new byte[8192];
        long count = 0;
        int read;
        while ((read = input.read(buffer)) != -1) {
            count += read;
            if (count > expectedSize) {
                throw new IOException("Context file size changed");
            }
            digest.update(buffer, 0, read);
        }
        if (count != expectedSize) {
            throw new IOException("Incomplete context file");
        }
        return HexFormat.of().formatHex(digest.digest());
    }

    private static MessageDigest digest() {
        try {
            return MessageDigest.getInstance("SHA-256");
        }
        catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException(error);
        }
    }

    public record ContextFile(String kind, String agentPath, String beforeMessageId) { }

    public record TaskHandoffHistory(ContextFile groupHistory, ContextFile taskHistory) { }

    private record FileProof(long size, String checksum) { }
}
