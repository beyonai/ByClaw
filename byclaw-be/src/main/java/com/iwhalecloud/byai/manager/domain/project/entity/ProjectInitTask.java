package com.iwhalecloud.byai.manager.domain.project.entity;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * 项目初始化任务状态实体
 *
 * 用于异步任务状态跟踪和查询
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ProjectInitTask {

    /**
     * 任务ID（主键）
     */
    private String taskId;

    /**
     * 请求ID（关联审计日志）
     */
    private String requestId;

    /**
     * 用户ID
     */
    private String userId;

    /**
     * 仓库路径
     */
    private String repoPath;

    /**
     * 技能包名称
     */
    private String skillPackage;

    /**
     * 任务状态
     * PENDING - 等待执行
     * RUNNING - 执行中
     * SUCCESS - 成功
     * FAILED - 失败
     */
    private String status;

    /**
     * 当前步骤
     */
    private String currentStep;

    /**
     * 执行进度（0-100）
     */
    private Integer progress;

    /**
     * 错误信息（失败时）
     */
    private String errorMessage;

    /**
     * 结果信息（JSON 格式）
     */
    private String result;

    /**
     * 创建时间
     */
    private LocalDateTime createTime;

    /**
     * 更新时间
     */
    private LocalDateTime updateTime;

    /**
     * 完成时间
     */
    private LocalDateTime completeTime;

    /**
     * 过期时间（用于自动清理）
     */
    private LocalDateTime expireTime;
}
