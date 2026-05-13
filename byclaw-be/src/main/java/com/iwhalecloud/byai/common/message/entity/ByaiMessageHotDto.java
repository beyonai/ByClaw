package com.iwhalecloud.byai.common.message.entity;

import com.alibaba.fastjson.annotation.JSONField;
import com.fasterxml.jackson.annotation.JsonFormat;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * @author he.duming
 * @date 2026-02-09 14:07:12
 * @description TODO
 */
@Getter
@Setter
public class ByaiMessageHotDto {

    private String metadata;

    private String role;

    private Integer usage;

    private Long creatorId;

    private Long messageId;

    private Long sessionId;

    private Long taskId;

    private String messageStruct;

    private Date createTime;

    private Date belongDate;

    private String messageContent;

    private String relatedResources;

    private String callLogs;

    private String inferLog;

    private Integer msgStatus;

    private Long projectId;

    private String accessTerminal;

    /**
     * 关联资源标识
     */
    private String resComIds;

    @JSONField(name = "isComplete")
    private boolean isComplete;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private Date archivedAt;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private Date updateTime;

    public String getCreateTimeMillis() {
        return createTime == null ? null : String.valueOf(createTime.getTime());
    }

    public String getBelongDateMillis() {
        return belongDate == null ? null : String.valueOf(belongDate.getTime());
    }

}
