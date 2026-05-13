package com.iwhalecloud.byai.common.message.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Data;

import java.util.Date;

/**
 * byai.byai_message 表实体
 */
@Data
@TableName("byai_message")
public class ByaiMessage {

    /**
     * 主键
     */
    @TableId(value = "id", type = IdType.INPUT)
    @JsonSerialize(using = ToStringSerializer.class)
    private Long id;

    private String metadata;

    /**
     * 角色
     */
    private String role;

    /**
     * 会话ID
     */
    @TableField("session_id")
    @JsonSerialize(using = ToStringSerializer.class)
    private Long sessionId;

    /**
     * 数字员工/超级助手所属任务ID
     */
    @TableField("task_id")
    @JsonSerialize(using = ToStringSerializer.class)
    private Long taskId;

    @TableField("access_terminal")
    private String accessTerminal;

    @TableField("append_index")
    @JsonSerialize(using = ToStringSerializer.class)
    private Long appendIndex;

    @TableField("archived_at")
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date archivedAt;

    @TableField("belong_date")
    @JsonFormat(pattern = "yyyy-MM-dd", timezone = "GMT+8")
    private Date belongDate;

    @TableField("call_logs")
    private String callLogs;

    @TableField("create_time")
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date createTime;

    @TableField("creator_id")
    @JsonSerialize(using = ToStringSerializer.class)
    private Long creatorId;

    @TableField("creator_name")
    private String creatorName;

    @TableField("enterprise_id")
    @JsonSerialize(using = ToStringSerializer.class)
    private Long enterpriseId;

    @TableField("final_content")
    private String finalContent;

    @TableField("final_message_struct")
    private String finalMessageStruct;

    @TableField("infer_log")
    private String inferLog;

    @TableField("is_complete")
    private Boolean isComplete;

    @TableField("message_content")
    private String messageContent;

    @TableField("message_id")
    @JsonSerialize(using = ToStringSerializer.class)
    private Long messageId;

    @TableField("message_ref")
    @JsonSerialize(using = ToStringSerializer.class)
    private Long messageRef;

    @TableField("message_struct")
    private String messageStruct;

    @TableField("msg_status")
    private Integer msgStatus;

    @TableField("project_id")
    @JsonSerialize(using = ToStringSerializer.class)
    private Long projectId;

    @TableField("rel_message_id")
    @JsonSerialize(using = ToStringSerializer.class)
    private Long relMessageId;

    @TableField("rel_objs")
    private String relObjs;

    @TableField("related_resources")
    private String relatedResources;

    @TableField("res_com_id")
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resComId;

    @TableField("res_com_ids")
    private String resComIds;

    @TableField("update_time")
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date updateTime;

    /**
     * 使用次数（usage int4）
     */
    private Integer usage;

    // -------- doc_* 字段（文档/离线索引字段）--------

    @TableField("doc_access_terminal")
    private String docAccessTerminal;

    @TableField("doc_belong_date")
    @JsonFormat(pattern = "yyyy-MM-dd", timezone = "GMT+8")
    private Date docBelongDate;

    @TableField("doc_create_time")
    private String docCreateTime;

    @TableField("doc_creator_id")
    @JsonSerialize(using = ToStringSerializer.class)
    private Long docCreatorId;

    @TableField("doc_infer_log")
    private String docInferLog;

    @TableField("doc_is_complete")
    private Boolean docIsComplete;

    @TableField("doc_message_content")
    private String docMessageContent;

    @TableField("doc_message_id")
    @JsonSerialize(using = ToStringSerializer.class)
    private Long docMessageId;

    @TableField("doc_message_struct")
    private String docMessageStruct;

    @TableField("doc_metadata")
    private String docMetadata;

    @TableField("doc_msg_status")
    private Long docMsgStatus;

    @TableField("doc_project_id")
    @JsonSerialize(using = ToStringSerializer.class)
    private Long docProjectId;

    @TableField("doc_related_resources")
    private String docRelatedResources;

    @TableField("doc_res_com_ids")
    private String docResComIds;

    @TableField("doc_session_id")
    @JsonSerialize(using = ToStringSerializer.class)
    private Long docSessionId;

    @TableField("doc_task_id")
    @JsonSerialize(using = ToStringSerializer.class)
    private Long docTaskId;

    @TableField("doc_usage")
    private Long docUsage;
}
