package com.iwhalecloud.byai.manager.domain.project.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.domain.project.entity.ProjectInitAuditLog;
import com.iwhalecloud.byai.manager.dto.project.ProjectInitRequest;
import com.iwhalecloud.byai.manager.dto.project.ProjectInitResponse;
import com.iwhalecloud.byai.manager.mapper.project.ProjectInitAuditLogMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 项目初始化审计日志服务
 *
 * 记录项目初始化的完整审计轨迹
 *
 * 设计原则：
 * 1. 审计日志是不可变的（只 INSERT，不 UPDATE）
 * 2. 只在任务结束时记录一条最终状态
 * 3. 所有时间戳在 Java 中生成，不使用数据库函数
 */
@Slf4j
@Service
public class ProjectInitAuditService {

    @Autowired
    private ProjectInitAuditLogMapper auditLogMapper;

    @Autowired
    private ObjectMapper objectMapper;

    /**
     * 记录操作成功（异步）
     *
     * 只在任务成功完成时调用，INSERT 一条最终状态的审计记录
     *
     * @param requestId 请求ID
     * @param request 初始化请求
     * @param response 初始化响应
     * @param userId 用户ID
     * @param username 用户名
     * @param ipAddress IP地址
     * @param startTime 开始时间
     * @param endTime 结束时间
     * @param durationMs 执行耗时
     */
    @Async("auditLogExecutor")
    public void logSuccess(String requestId, ProjectInitRequest request, ProjectInitResponse response,
                          String userId, String username, String ipAddress,
                          LocalDateTime startTime, LocalDateTime endTime, long durationMs) {
        try {
            // 构建变更详情
            Map<String, Object> changes = new HashMap<>();
            changes.put("skillPackages", response.getSkillPackages());
            changes.put("addedSubmodules", response.getAddedSubmodules());
            changes.put("commitHash", response.getCommitHash());
            changes.put("pushed", response.getPushed());

            LocalDateTime now = LocalDateTime.now();

            // 将技能包列表转为逗号分隔的字符串，用于数据库存储
            String skillPackageStr = (response.getSkillPackages() != null && !response.getSkillPackages().isEmpty())
                ? String.join(",", response.getSkillPackages())
                : "none";

            ProjectInitAuditLog auditLog = ProjectInitAuditLog.builder()
                .requestId(requestId)
                .userId(userId)
                .username(username)
                .ipAddress(ipAddress)
                .repoPath(response.getRepoPath())
                .skillPackage(skillPackageStr)
                .branch(response.getBranch())
                .submoduleCount(response.getAddedSubmodules() != null ? response.getAddedSubmodules().size() : 0)
                .status("SUCCESS")
                .durationMs(durationMs)
                .commitHash(response.getCommitHash())
                .pushed(response.getPushed())
                .changes(objectMapper.writeValueAsString(changes))
                .startTime(startTime)
                .endTime(endTime)
                .createTime(now)
                .build();

            auditLogMapper.insert(auditLog);
            log.info("Audit log recorded for successful request: {}", requestId);

        } catch (Exception e) {
            log.error("Failed to record audit log for request: {}", requestId, e);
        }
    }

    /**
     * 记录操作失败（异步）
     *
     * 只在任务失败时调用，INSERT 一条最终状态的审计记录
     *
     * @param requestId 请求ID
     * @param request 初始化请求
     * @param userId 用户ID
     * @param username 用户名
     * @param ipAddress IP地址
     * @param startTime 开始时间
     * @param endTime 结束时间
     * @param durationMs 执行耗时
     * @param errorMessage 错误信息
     */
    @Async("auditLogExecutor")
    public void logFailure(String requestId, ProjectInitRequest request,
                          String userId, String username, String ipAddress,
                          LocalDateTime startTime, LocalDateTime endTime, long durationMs,
                          String errorMessage) {
        try {
            LocalDateTime now = LocalDateTime.now();

            // 将技能包列表转为逗号分隔的字符串，用于数据库存储
            String skillPackageStr = (request.getSkillPackages() != null && !request.getSkillPackages().isEmpty())
                ? String.join(",", request.getSkillPackages())
                : "none";

            ProjectInitAuditLog auditLog = ProjectInitAuditLog.builder()
                .requestId(requestId)
                .userId(userId)
                .username(username)
                .ipAddress(ipAddress)
                .repoPath("project_" + request.getProjectId())  // 失败时可能还没有真实路径
                .skillPackage(skillPackageStr)
                .branch(request.getRepoBranch())
                .submoduleCount(request.getSubmodules() != null ? request.getSubmodules().size() : 0)
                .status("FAILED")
                .durationMs(durationMs)
                .errorMessage(truncateErrorMessage(errorMessage))
                .startTime(startTime)
                .endTime(endTime)
                .createTime(now)
                .build();

            auditLogMapper.insert(auditLog);
            log.info("Audit log recorded for failed request: {}", requestId);

        } catch (Exception e) {
            log.error("Failed to record audit log for request: {}", requestId, e);
        }
    }

    /**
     * 查询审计日志列表
     *
     * @param userId 用户ID（可选）
     * @param repoPath 仓库路径（可选）
     * @param status 状态（可选）
     * @param startTime 开始时间（可选）
     * @param endTime 结束时间（可选）
     * @param page 页码（从1开始）
     * @param pageSize 每页大小
     * @return 审计日志列表
     */
    public List<ProjectInitAuditLog> queryLogs(String userId, String repoPath, String status,
                                               LocalDateTime startTime, LocalDateTime endTime,
                                               int page, int pageSize) {
        int offset = (page - 1) * pageSize;
        return auditLogMapper.selectList(userId, repoPath, status, startTime, endTime, offset, pageSize);
    }

    /**
     * 统计审计日志总数
     *
     * @param userId 用户ID（可选）
     * @param repoPath 仓库路径（可选）
     * @param status 状态（可选）
     * @param startTime 开始时间（可选）
     * @param endTime 结束时间（可选）
     * @return 总数
     */
    public int countLogs(String userId, String repoPath, String status,
                        LocalDateTime startTime, LocalDateTime endTime) {
        return auditLogMapper.count(userId, repoPath, status, startTime, endTime);
    }

    /**
     * 清理过期的审计日志
     * 默认保留 90 天
     */
    @Async("auditLogExecutor")
    public void cleanExpiredLogs() {
        try {
            LocalDateTime expireTime = LocalDateTime.now().minusDays(90);
            int deleted = auditLogMapper.deleteExpiredLogs(expireTime);
            log.info("Cleaned {} expired audit logs (before {})", deleted, expireTime);
        } catch (Exception e) {
            log.error("Failed to clean expired audit logs", e);
        }
    }

    /**
     * 截断错误信息（最多保留 1000 字符）
     */
    private String truncateErrorMessage(String errorMessage) {
        if (errorMessage == null) {
            return null;
        }
        if (errorMessage.length() <= 1000) {
            return errorMessage;
        }
        return errorMessage.substring(0, 1000) + "... (truncated)";
    }
}
