package com.iwhalecloud.byai.manager.dto.project;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

import java.util.List;

/**
 * 项目初始化请求
 *
 * 用于初始化集成项目的技能包（Trellis 或 Superpower）
 */
@Data
public class ProjectInitRequest {

    /**
     * 项目 ID
     *
     * 用于查询 ProjectRepo 并根据 provider 策略提取仓库标识：
     * - GitHub: 优先使用 repoFullName，降级到 URL 解析
     * - GitLab/Gitea/其他: 从 repoUrl 解析
     * 例如: projectId=12345 → ProjectRepo(repoFullName="byclaw/backend") → /data/git-repos/byclaw/backend
     */
    @NotNull(message = "{projectinitrequest.projectid.notnull}")
    private Long projectId;

    /**
     * 集成仓库分支名称（可选）
     *
     * 如果提供，会在初始化前切换到该分支（不存在则创建）
     */
    private String repoBranch;

    /**
     * 技能包名称（可选）
     *
     * 可选值: "trellis" 或 "superpower"
     * 如果不指定，则只执行 Git 操作（clone/submodule），不初始化技能包
     */
    private String skillPackageName;

    /**
     * 要添加的子模块列表（可选）
     *
     * 每个子模块包含 URL、路径和可选的分支信息
     */
    @Valid
    private List<SubmoduleInfo> submodules;

    /**
     * 是否自动提交
     *
     * 默认: true
     */
    private Boolean autoCommit = true;

    /**
     * 是否自动推送到远程仓库
     *
     * 默认: true
     * 注意: 只有当 autoCommit=true 时才会执行推送
     */
    private Boolean autoPush = true;

    /**
     * 自定义提交消息（可选）
     *
     * 如果不提供，则使用默认消息: "chore: init {skillPackageName} skill package"
     */
    private String commitMessage;
}
