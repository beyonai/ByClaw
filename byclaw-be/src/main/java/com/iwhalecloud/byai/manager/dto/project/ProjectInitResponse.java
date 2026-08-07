package com.iwhalecloud.byai.manager.dto.project;

import com.fasterxml.jackson.annotation.JsonIgnore;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * 项目初始化响应
 *
 * 返回初始化操作的结果信息
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ProjectInitResponse {

    /**
     * 仓库绝对路径（仅内部使用，不返回给前端）
     *
     * 例如: /data/git-repos/project-123
     */
    @JsonIgnore
    private String repoPath;

    /**
     * 当前分支名称
     */
    private String branch;

    /**
     * 已初始化的技能包列表
     *
     * 例如: ["trellis", "superpower"]
     */
    private List<String> skillPackages;

    /**
     * 成功添加的子模块路径列表
     *
     * 例如: ["modules/repo1", "modules/repo2"]
     */
    private List<String> addedSubmodules;

    /**
     * 提交哈希值（如果执行了提交）
     *
     * 例如: "abc123def456..."
     */
    private String commitHash;

    /**
     * 是否已推送到远程仓库
     */
    private Boolean pushed;

    /**
     * 操作消息
     *
     * 成功时返回详细的操作摘要，失败时返回错误描述
     */
    private String message;

    /**
     * 创建成功响应的便捷方法
     */
    public static ProjectInitResponse success(String repoPath, String branch, List<String> skillPackages,
                                               List<String> addedSubmodules, String commitHash, Boolean pushed) {
        StringBuilder msg = new StringBuilder("Successfully initialized");

        if (skillPackages != null && !skillPackages.isEmpty()) {
            msg.append(" ").append(String.join(", ", skillPackages)).append(" skill package(s)");
        }

        if (addedSubmodules != null && !addedSubmodules.isEmpty()) {
            msg.append(" and added ").append(addedSubmodules.size()).append(" submodule(s)");
        }

        if (commitHash != null) {
            msg.append(". Commit: ").append(commitHash.substring(0, Math.min(8, commitHash.length())));
        }

        if (Boolean.TRUE.equals(pushed)) {
            msg.append(". Pushed to remote.");
        }

        return ProjectInitResponse.builder()
            .repoPath(repoPath)
            .branch(branch)
            .skillPackages(skillPackages)
            .addedSubmodules(addedSubmodules)
            .commitHash(commitHash)
            .pushed(pushed)
            .message(msg.toString())
            .build();
    }

    /**
     * 创建失败响应的便捷方法
     */
    public static ProjectInitResponse failure(String repoPath, String errorMessage) {
        return ProjectInitResponse.builder()
            .repoPath(repoPath)
            .message("Initialization failed: " + errorMessage)
            .build();
    }
}
