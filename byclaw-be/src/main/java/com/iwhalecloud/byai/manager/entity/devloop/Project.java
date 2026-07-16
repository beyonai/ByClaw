package com.iwhalecloud.byai.manager.entity.devloop;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

@Getter
@Setter
@TableName("byai_project")
public class Project {

    @TableId(value = "project_id", type = IdType.INPUT)
    private Long projectId;

    private String projectName;

    private String description;

    private Long resourceId;

    private Long createBy;

    private Date createTime;

    private Long updateBy;

    private Date updateTime;

    private String deleteFlag;
}
