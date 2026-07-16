package com.iwhalecloud.byai.manager.entity.devloop;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * 项目会话关联实体，用于把一个项目下的多个会话组织起来。
 */
@Getter
@Setter
@TableName("byai_project_session")
public class ProjectSession {

    @TableId(value = "relation_id", type = IdType.INPUT)
    private Long relationId;

    private Long projectId;

    private Long sessionId;

    private String createBy;

    private Date createTime;

    private String updateBy;

    private Date updateTime;

    private String deleteFlag;
}
