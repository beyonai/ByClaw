package com.iwhalecloud.byai.manager.domain.tenant;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import com.iwhalecloud.byai.state.common.dto.AnswerDelta;
import com.iwhalecloud.byai.state.domain.chat.model.MessageFileDto;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;

/** The REST payloads shared by BE and the tenant Node. */
public final class TenantNodeModels {

    private TenantNodeModels() {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ProvisionState(String status, long generation) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Registration(String enterpriseId, String generation, String dbSandboxRecordId,
                               String instanceId, String agentType, String mode) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ReadyView(String enterpriseId, String generation, String dbSandboxRecordId,
                            boolean ready) {
    }

    public record SessionQuery(int pageNum, int pageSize, String keyword, List<String> sessionTypes,
                               String projectId) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Page<T>(List<T> list, long total, int pageNum, int pageSize, int totalPages) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record SessionView(String sessionId, String sessionName, String sessionType,
                              String createTime, String updateTime, String sessionContent,
                              String creatorId, String enterpriseId, String projectId) {
    }

    public record MessageQuery(String sessionId, long pageNum, long pageSize) {
    }

    public record SessionRef(String sessionId) {
    }

    public record MessageIds(List<Long> messageIds) {
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class MessageView {
        private String messageId;
        private String sessionId;
        private String enterpriseId;
        private String topicId;
        private String messageRef;
        private Integer usage;
        private String role;
        private String creatorId;
        private String creatorName;
        private String createTime;
        private String messageContent;
        private String metadata;
        private String messageStruct;
        private String relatedResources;
        private String inferLog;
        private String msgStatus;
        private String resComIds;
        private Boolean isComplete;
        private Boolean complete;
        private Boolean recalled;
        private String recalledAt;
        private String recalledBy;

        public String messageId() {
            return messageId;
        }

        public String sessionId() {
            return sessionId;
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record MessageOutline(String messageId, String role, Integer usage, String content,
                                 String displayContent, String creatorName, String createTime,
                                 long position, long totalCount, boolean recalled) {
    }

    public sealed interface CommandPayload permits SessionCreate, GroupCreate, SessionUpdate, MessageId, EmptyPayload,
        GroupMessagePayload, AddMembers, RemoveMember {
    }

    public record SessionCreate(String sessionName, String sessionType) implements CommandPayload {
    }

    public record GroupMember(String memObjType, String memObjId, String userRole, String memName) {
    }

    public record GroupCreate(String sessionName, String projectId, List<GroupMember> members)
        implements CommandPayload {
    }

    public record InvitedMember(String memObjType, String memObjId, String memName,
                                boolean resourceAuthorized) {
    }

    public record AddMembers(List<InvitedMember> members) implements CommandPayload {
    }

    public record RemoveMember(String memObjType, String memObjId) implements CommandPayload {
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record SessionUpdate(String sessionName, String sessionContent) implements CommandPayload {
    }

    public record MessageId(String messageId) implements CommandPayload {
    }

    public record EmptyPayload() implements CommandPayload {
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record GroupMessagePayload(String chatContent, List<ResourceVo> resourceList,
                                      List<MessageFileDto> files, String replyToMessageId,
                                      String creatorName) implements CommandPayload {
    }

    public sealed interface MirrorPayload permits MirrorInputPayload, MirrorAnswerPayload {
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record MirrorInputPayload(String id, String userId, String creatorName,
                                     String messageContent) implements MirrorPayload {
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record MirrorAnswerMetadata(String role, String agentId, String mode,
                                       String resourceName, String resourceType, String resourceId,
                                       String agentType, MirrorUsedModel usedModel) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record MirrorUsedModel(String id, String code, String name, String provider,
                                  String thinkingLevel) {
    }

    public record MirrorAnswerPayload(String id, String relationId, String messageContent,
                                      String finalContent, String creatorName,
                                      MirrorAnswerMetadata metadata, List<AnswerDelta> messageStruct,
                                      List<AnswerDelta> inferLog) implements MirrorPayload {
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record MirrorEvent(String sessionId, String clientRequestId, String runId, String traceId,
                              String userMessageId, String answerMessageId, String eventId,
                              @JsonInclude(JsonInclude.Include.ALWAYS) String sourceStreamId,
                              int childOrdinal, String eventSeq, String eventType,
                              MirrorPayload payload) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record MirrorResult(String eventId, boolean committed) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ErrorEnvelope(ErrorCode error) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ErrorCode(String code) {
    }

    public record CommandHashBody(int protocolVersion, String enterpriseId, String userId,
                                  String requestId, String sessionId, String operation,
                                  CommandPayload payload) {
    }

    public record CommandRequest(int protocolVersion, String enterpriseId, String generation,
                                 String dbSandboxRecordId, String userId, String requestId,
                                 String sessionId, String operation, List<String> tenantMemberUserIds,
                                 String requestHash, CommandPayload payload) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record CommandResult(String sessionId, String requestId, String operation, String messageId) {
    }
}
