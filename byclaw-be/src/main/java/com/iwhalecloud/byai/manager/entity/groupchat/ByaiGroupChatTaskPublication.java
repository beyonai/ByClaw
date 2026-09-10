package com.iwhalecloud.byai.manager.entity.groupchat;

import java.util.Date;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import lombok.Data;

/** 已发布任务成果的文本与项目云盘逻辑文件快照。 */
@Data
@TableName("byai_group_chat_task_publication")
public class ByaiGroupChatTaskPublication {
    @TableId(value = "task_session_id", type = IdType.INPUT)
    private Long taskSessionId;
    private Long groupSessionId;
    private Long messageId;
    private Long publisherUserId;
    private String textContent;
    private String filesJson;
    private Date createTime;
}
