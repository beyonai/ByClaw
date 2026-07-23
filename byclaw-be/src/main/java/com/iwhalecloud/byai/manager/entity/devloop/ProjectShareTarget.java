package com.iwhalecloud.byai.manager.entity.devloop;

import java.util.Date;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@TableName("byai_project_share")
public class ProjectShareTarget {

    @TableId(value = "share_id", type = IdType.INPUT)
    private Long shareId;

    private Long projectId;

    /** 共享对象类型：USER人员，ORG组织 */
    private String targetType;

    private Long targetId;

    private String targetName;

    private Long createBy;

    private Date createTime;
}
