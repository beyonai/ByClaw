package com.iwhalecloud.byai.state.domain.chat.dto;

import java.util.ArrayList;
import java.util.List;

import lombok.Data;

import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;

/**
 * ByClaw BE 对外提供的群聊事实快照。消息正文只通过该受鉴权接口返回。
 */
@Data
public class GroupChatContextResponse {

    private String schemaVersion = "byclaw.group-chat-context/v1";

    private String conversationKey;

    private Snapshot snapshot;

    private List<Message> messages = new ArrayList<>();

    private Truncation truncation;

    @Data
    public static class Snapshot {

        private String beforeMessageId;

        private String lastIncludedMessageId;

        private Long generatedAt;
    }

    @Data
    public static class Message {

        /** 关联发送队列，支持广播早于 ACK 或重连后的确认恢复。 */
        private String clientRequestId;

        private boolean recalled;

        private Recall recall;

        /** 任务卡片关联的任务会话 ID，与当前群会话 ID 不同。 */
        private String taskId;

        /** 任务发起者 ID，供任务消息回复权限展示；字符串保留完整 ID 精度，未知时为空。 */
        private String initiatorUserId;

        private String kind;

        /** 消息用途；5 为会话展示事件，不是模型指令。 */
        private Integer usage;

        private SystemEvent systemEvent;

        private String messageId;

        /** 引用链归属，系统事件和未回填历史消息为空。 */
        private String topicId;

        private Integer sequence;

        private Long createdAt;

        private String role;

        private Speaker speaker;

        private Target target;

        private String content;

        /** 与实时群消息一致的成员引用，用于还原正文中的占位符。 */
        private List<ResourceVo> resourceList = new ArrayList<>();

        /** 被@真人用户的确认状态；确认不会创建新的消息。 */
        private List<MessageAcknowledgement> acknowledgements = new ArrayList<>();

        /** 仅当前登录用户使用：是否可以点击“收到”。 */
        private boolean canAcknowledge;

        private ReplyReference replyTo;

        private List<Attachment> attachments;
    }

    @Data
    public static class MessageAcknowledgement {
        private String messageId;
        private String userId;
        private String userName;
        private Long acknowledgedAt;
    }

    @Data
    public static class ReplyReference {
        private boolean recalled;
        private Integer usage;
        private String messageId;
        private String content;

        /** 与实时群消息一致的成员引用，用于还原正文中的占位符。 */
        private List<ResourceVo> resourceList = new ArrayList<>();
        private String role;
        private Speaker speaker;
    }

    /** 操作人名称来自读取时的 Redis 用户信息，不持久化名称副本。 */
    @Data
    public static class Recall {
        private String operatorId;
        private String operatorName;
        private Long recalledAt;
    }

    /** 事件发生时的操作者和成员快照，ID 使用字符串避免精度丢失。 */
    @Data
    public static class SystemEvent {
        private String eventType;
        private String operatorId;
        private String operatorName;
        private String memberId;
        private String memberType;
        private String memberName;
    }

    @Data
    public static class Speaker {

        private String type;

        private String userCode;

        private String displayName;

        private String agentId;

        private String agentName;
    }

    @Data
    public static class Target {

        private String type = "agent";

        private String agentId;

        private String agentName;
    }

    @Data
    public static class Attachment {

        private String fileId;

        private String fileName;

        private String mediaType;

        private String fileUrl;

        /** 云盘附件使用知识库 ID 和完整路径定位，fileId 可以为空。 */
        private String cloudResourceId;

        private String filePath;
    }

    @Data
    public static class Truncation {

        private Boolean truncated;

        private Integer omittedMessageCount;

        private String reason;
    }
}
