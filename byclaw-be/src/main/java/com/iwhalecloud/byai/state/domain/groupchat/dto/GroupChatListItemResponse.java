package com.iwhalecloud.byai.state.domain.groupchat.dto;

import java.util.Date;
import java.util.List;

import com.alibaba.fastjson.annotation.JSONField;
import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextResponse;

import lombok.Getter;
import lombok.Setter;

/** 当前用户的群聊列表项及未读消息投影。 */
@Getter
@Setter
public class GroupChatListItemResponse {
    @JsonSerialize(using = ToStringSerializer.class)
    private Long sessionId;

    private String name;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long enterpriseId;

    private String enterpriseName;

    /**
     * 进入群组时使用的租户 ID。
     * 公共库里的历史群组仍保留原 enterpriseId 用于展示，但原租户已经删除或没有可用 Node 时，
     * 需要改走默认公共租户 1，避免点击群组时触发失效租户切换。
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long routingEnterpriseId;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long projectId;

    private String role;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long latestMessageId;

    private String latestMessageContent;

    /** 最新消息的附件，结构与群消息时间线一致。 */
    private List<GroupChatContextResponse.Attachment> latestMessageAttachments = List.of();

    /** 仅供列表附件投影使用，不向客户端暴露原始关联资源。 */
    @JsonIgnore
    @JSONField(serialize = false)
    private String latestMessageRelatedResources;

    @JsonIgnore
    @JSONField(serialize = false)
    private Date latestMessageRecalledAt;

    @JsonIgnore
    @JSONField(serialize = false)
    private Long latestMessageRecalledBy;

    public boolean isLatestMessageRecalled() {
        return latestMessageRecalledAt != null;
    }

    /** 仅供列表摘要投影使用，不向客户端暴露完整消息元数据。 */
    @JsonIgnore
    @JSONField(serialize = false)
    private String latestMessageMetadata;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date latestMessageTime;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long latestMessageCreatorId;

    private String latestMessageCreatorName;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long lastReadMessageId;

    private long unreadCount;

    /** 与旧接口字段兼容；新前端统一读取 unreadCount。 */
    private long unreadMessageCount;

    private long unreadMentionCount;

    /** 侧栏组合头像使用，按角色稳定排序且最多返回九位。 */
    private List<GroupChatMemberSummary> members = List.of();

    @JsonSerialize(using = ToStringSerializer.class)
    private Long latestMentionMessageId;

    public boolean isHasUnreadMention() {
        return unreadMentionCount > 0;
    }
}
