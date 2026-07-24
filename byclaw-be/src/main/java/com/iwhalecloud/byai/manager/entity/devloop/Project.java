package com.iwhalecloud.byai.manager.entity.devloop;

import com.alibaba.fastjson.annotation.JSONField;
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

    /** 项目类型：normal普通项目，develop研发项目 */
    private String projectType;

    /** 是否分享：N-不分享，Y-可分享 */
    private String isShare;

    private Long createBy;

    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date createTime;

    private Long updateBy;

    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date updateTime;

    private String deleteFlag;
}
