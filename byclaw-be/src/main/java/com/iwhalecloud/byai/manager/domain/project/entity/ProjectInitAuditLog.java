package com.iwhalecloud.byai.manager.domain.project.entity;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * 项目初始化审计日志实体
 *
 * 记录项目初始化的完整审计轨迹，满足企业合规要求
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ProjectInitAuditLog {

    /**
     * 日志ID（自增主键）
     */
    private Long id;

    /**
     * 请求追踪ID（UUID）
     */
    private String requestId;

    /**
     * 操作用户ID
     */
    private String userId;

    /**
     * 操作用户名
     */
    private String username;

    /**
     * 客户端IP地址
     */
    private String ipAddress;

    /**
     * 仓库路径
     */
    private String repoPath;

    /**
     * 技能包类型（trellis/superpower）
     */
    private String skillPackage;

    /**
     * 分支名称
     */
    private String branch;

    /**
     * 子模块数量
     */
    private Integer submoduleCount;

    /**
     * 操作状态
     * - SUCCESS: 成功
     * - FAILED: 失败
     * - TIMEOUT: 超时
     * - CANCELLED: 取消
     */
    private String status;

    /**
     * 执行耗时（毫秒）
     */
    private Long durationMs;

    /**
     * 错误信息（失败时记录）
     */
    private String errorMessage;

    /**
     * 提交哈希值（成功时记录）
     */
    private String commitHash;

    /**
     * 是否推送到远程
     */
    private Boolean pushed;

    /**
     * 变更详情（JSON 格式）
     * 例如：{"addedFiles": [".trellis/config.yaml"], "submodules": ["path1", "path2"]}
     */
    private String changes;

    /**
     * 开始时间
     */
    private LocalDateTime startTime;

    /**
     * 结束时间
     */
    private LocalDateTime endTime;

    /**
     * 创建时间（数据库记录时间）
     */
    private LocalDateTime createTime;

    /**
     * 更新时间
     */
    private LocalDateTime updateTime;
}
