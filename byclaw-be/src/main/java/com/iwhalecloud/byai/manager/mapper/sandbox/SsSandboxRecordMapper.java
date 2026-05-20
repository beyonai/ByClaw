package com.iwhalecloud.byai.manager.mapper.sandbox;

import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import java.util.Date;
import java.util.List;

/**
 * 沙箱记录Mapper接口
 */
@Mapper
public interface SsSandboxRecordMapper {

    /**
     * 新增沙箱记录
     *
     * @param record 沙箱记录
     * @return 影响行数
     */
    int insert(SsSandboxRecord record);

    /**
     * 根据用户编码和资源ID查询运行中的沙箱记录
     *
     * @param userCode 用户编码
     * @param resourceId 资源ID
     * @return 沙箱记录
     */
    SsSandboxRecord selectRunningByUserAndResource(@Param("userCode") String userCode,
                                                   @Param("sandboxType") String sandboxType,
                                                   @Param("resourceId") Long resourceId);

    SsSandboxRecord selectActiveByUserAndResource(@Param("userCode") String userCode,
                                                  @Param("sandboxType") String sandboxType,
                                                  @Param("resourceId") Long resourceId);

    /**
     * 根据用户编码和资源ID列表批量查询运行中的沙箱记录
     *
     * @param userCode 用户编码
     * @param resourceIds 资源ID列表
     * @return 沙箱记录列表
     */
    List<SsSandboxRecord> selectRunningByUserAndResources(@Param("userCode") String userCode,
                                                          @Param("sandboxType") String sandboxType,
                                                          @Param("resourceIds") List<Long> resourceIds);

    List<SsSandboxRecord> selectRunningByUser(@Param("userCode") String userCode);

    /**
     * 更新沙箱状态为已释放
     *
     * @param id 沙箱记录ID
     * @return 影响行数
     */
    int updateStatusToReleased(@Param("id") Long id,
                               @Param("reason") String reason,
                               @Param("releaseTime") Date releaseTime);

    int markReleased(@Param("id") Long id,
                     @Param("reason") String reason,
                     @Param("releaseTime") Date releaseTime);

    int markStartingReleased(@Param("id") Long id,
                             @Param("reason") String reason,
                             @Param("releaseTime") Date releaseTime);

    int updateLaunchSuccess(@Param("id") Long id,
                            @Param("sandboxId") String sandboxId,
                            @Param("endpoint") String endpoint,
                            @Param("timeoutSeconds") Integer timeoutSeconds,
                            @Param("remoteExpiresAt") Date remoteExpiresAt,
                            @Param("lastRenewAt") Date lastRenewAt,
                            @Param("nextRenewAt") Date nextRenewAt,
                            @Param("lastAccessTime") Date lastAccessTime);

    int updateStatusToFailed(@Param("id") Long id,
                             @Param("reason") String reason,
                             @Param("updateTime") Date updateTime);

    /**
     * 更新最近一次访问时间
     *
     * @param id 沙箱记录ID
     * @param lastAccessTime 最近访问时间（使用应用系统当前时间，避免数据库时间不准确）
     * @return 影响行数
     */
    int updateLastAccessTime(@Param("id") Long id, @Param("lastAccessTime") Date lastAccessTime);

    /**
     * 查询超时的自动释放沙箱记录
     *
     * @param timeoutMinutes 超时时间（分钟）
     * @return 超时的沙箱记录列表
     */
    int countExpiredSandboxes(@Param("timeoutMinutes") int timeoutMinutes);

    List<SsSandboxRecord> selectExpiredSandboxesPage(@Param("timeoutMinutes") int timeoutMinutes,
                                                     @Param("cursorTime") Date cursorTime,
                                                     @Param("cursorId") Long cursorId,
                                                     @Param("limit") int limit);

    int countDueRenewSandboxes(@Param("now") Date now);

    List<SsSandboxRecord> selectDueRenewSandboxesPage(@Param("now") Date now,
                                                      @Param("cursorTime") Date cursorTime,
                                                      @Param("cursorId") Long cursorId,
                                                      @Param("limit") int limit);

    int countReconcileSandboxes();

    List<SsSandboxRecord> selectReconcileSandboxesPage(@Param("cursorTime") Date cursorTime,
                                                       @Param("cursorId") Long cursorId,
                                                       @Param("limit") int limit);

    int updateRenewSuccess(@Param("id") Long id,
                           @Param("remoteExpiresAt") Date remoteExpiresAt,
                           @Param("lastRenewAt") Date lastRenewAt,
                           @Param("nextRenewAt") Date nextRenewAt);

    int markReleasing(@Param("id") Long id,
                      @Param("reason") String reason,
                      @Param("updateTime") Date updateTime);

    /**
     * 统计当前运行中的沙箱数量
     *
     * @return 运行中（status=RUNNING）的沙箱记录数量
     */
    int countRunningSandboxes();

    /**
     * 分页查询沙箱记录
     *
     * @param keyword 关键字（匹配userCode、endpoint、chatId）
     * @param status 状态过滤
     * @param offset 偏移量
     * @param pageSize 每页大小
     * @return 沙箱记录列表
     */
    List<SsSandboxRecord> selectByPage(@Param("keyword") String keyword,
                                       @Param("status") String status,
                                       @Param("offset") int offset,
                                       @Param("pageSize") int pageSize);

    /**
     * 统计满足条件的沙箱记录总数
     *
     * @param keyword 关键字
     * @param status 状态过滤
     * @return 总数
     */
    int countByCondition(@Param("keyword") String keyword,
                         @Param("status") String status);

    /**
     * 根据ID查询沙箱记录
     *
     * @param id 记录ID
     * @return 沙箱记录
     */
    SsSandboxRecord selectById(@Param("id") Long id);

    int updateAutoRelease(@Param("id") Long id, @Param("autoRelease") Integer autoRelease);
}
