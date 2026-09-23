package com.iwhalecloud.byai.manager.entity.groupchat;

import java.util.Date;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

/** 每个任务仅保留一份待发布内容，替换后旧 pendingPublicationId 失效。 */
@Data
@TableName("byai_group_chat_pending_publication")
public class ByaiGroupChatPendingPublication {
    @TableId(value = "task_session_id", type = IdType.INPUT)
    private Long taskSessionId;
    private Long pendingPublicationId;
    private String textContent;
    private String sourceFilesJson;
    private String uploadedFilesJson;
    private Long cloudResourceId;
    private Date createTime;
}
