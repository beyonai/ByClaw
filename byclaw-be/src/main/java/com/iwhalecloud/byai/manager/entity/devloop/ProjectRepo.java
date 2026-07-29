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
@TableName("byai_project_repo")
public class ProjectRepo {

    @TableId(value = "repo_id", type = IdType.INPUT)
    private Long repoId;

    private Long projectId;

    private String repoFullName;

    private String repoUrl;

    private String defaultBranch;

    private String createBy;

    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date createTime;
}
