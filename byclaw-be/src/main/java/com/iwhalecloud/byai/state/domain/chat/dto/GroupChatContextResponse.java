package com.iwhalecloud.byai.state.domain.chat.dto;

import java.util.ArrayList;
import java.util.List;

import lombok.Data;

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

        private String messageId;

        private Integer sequence;

        private Long createdAt;

        private String role;

        private Speaker speaker;

        private Target target;

        private String content;

        private List<Attachment> attachments;
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
    }

    @Data
    public static class Truncation {

        private Boolean truncated;

        private Integer omittedMessageCount;

        private String reason;
    }
}
