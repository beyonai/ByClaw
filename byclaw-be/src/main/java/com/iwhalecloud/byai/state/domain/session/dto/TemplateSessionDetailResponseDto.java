package com.iwhalecloud.byai.state.domain.session.dto;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import java.io.Serializable;
import java.util.Date;
import java.util.List;
import java.util.Map;
import lombok.Data;

/**
 * 模板会话详情响应DTO 包含会话信息、扩展信息和聊天记录列表
 *
 * @author smartcloud
 */
@Data
public class TemplateSessionDetailResponseDto implements Serializable {

    /**
     * 会话基本信息
     */
    private SessionInfo sessionInfo;

    /**
     * 模板扩展信息
     */
    private TemplateExtInfo templateExtInfo;

    /**
     * 聊天记录列表
     */
    private List<MessageInfo> messageList;

    /**
     * 会话基本信息
     */
    @Data
    public static class SessionInfo implements Serializable {
        private Long sessionId;

        private String sessionName;

        private String sessionContent;

        private String sessionType;

        private Long creatorId;

        private Long enterpriseId;

        @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
        private Date createTime;

        @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
        private Date updateTime;

        private Boolean isTemplate;
    }

    /**
     * 模板扩展信息
     */
    /**
     * 模板扩展信息
     */
    @Data
    public static class TemplateExtInfo implements Serializable {
        private String templateType;

        private String templateTypeName;

        private String templateTitle;

        @JsonSerialize(using = ToStringSerializer.class)
        private Long templateCoverId;

        private String templateConfig;

        private Long originalSessionId;

        private String terminal;

        private Map<String, String> extParams;
    }

    /**
     * 消息信息
     */
    @Data
    public static class MessageInfo implements Serializable {
        private Long messageId;

        private String messageContent;

        private String messageStruct;

        private String inferLog;

        private String messageType;

        private Long senderId;

        private String senderName;

        @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
        private Date createTime;

        @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
        private Date updateTime;

        // 新增字段，对应JSON中的完整字段
        private Integer usage;

        private String metadata;

        private Long creatorId;

        private String creatorName;

        private Long sessionId;

        private Integer msgStatus;

        private String accessTerminal;

        private String belongDate;

        private Long projectId;

        private String relatedResources;

        private Long taskId;
    }
}
