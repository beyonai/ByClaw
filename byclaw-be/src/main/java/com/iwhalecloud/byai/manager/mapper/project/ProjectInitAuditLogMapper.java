package com.iwhalecloud.byai.manager.mapper.project;

import com.iwhalecloud.byai.manager.domain.project.entity.ProjectInitAuditLog;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 项目初始化审计日志 Mapper
 *
 * 审计日志是不可变的，只提供 INSERT 和查询操作，不提供 UPDATE
 */
@Mapper
public interface ProjectInitAuditLogMapper {

    /**
     * 插入审计日志
     *
     * @param log 审计日志
     * @return 影响行数
     */
    int insert(ProjectInitAuditLog log);

    /**
     * 根据请求ID查询最新的一条审计日志
     *
     * @param requestId 请求ID
     * @return 审计日志（按创建时间倒序，取第一条）
     */
    ProjectInitAuditLog selectByRequestId(@Param("requestId") String requestId);

    /**
     * 查询审计日志列表
     *
     * @param userId 用户ID（可选）
     * @param repoPath 仓库路径（可选）
     * @param status 状态（可选）
     * @param startTime 开始时间（可选）
     * @param endTime 结束时间（可选）
     * @param offset 偏移量
     * @param limit 限制数量
     * @return 审计日志列表
     */
    List<ProjectInitAuditLog> selectList(
        @Param("userId") String userId,
        @Param("repoPath") String repoPath,
        @Param("status") String status,
        @Param("startTime") LocalDateTime startTime,
        @Param("endTime") LocalDateTime endTime,
        @Param("offset") int offset,
        @Param("limit") int limit
    );

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
    int count(
        @Param("userId") String userId,
        @Param("repoPath") String repoPath,
        @Param("status") String status,
        @Param("startTime") LocalDateTime startTime,
        @Param("endTime") LocalDateTime endTime
    );

    /**
     * 删除过期的审计日志
     *
     * @param expireTime 过期时间
     * @return 删除行数
     */
    int deleteExpiredLogs(@Param("expireTime") LocalDateTime expireTime);
}
