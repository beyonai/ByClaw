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

    /** 仓库用途描述,人工填写;供需求 AI 预拆判断职责归属,也给后来人看。可空。 */
    private String description;

    /** 仓库类型 workspace工作区(单个)/code代码仓库(可多个);存量默认 code。 */
    private String repoType;

    /** 代码平台 github/gitlab/gitea;决定 clone host 与令牌变量,存量默认 github。 */
    private String provider;

    private String createBy;

    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date createTime;
}
