package com.iwhalecloud.byai.manager.mapper.datacloud;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.entity.datacloud.DatacloudScriptExecution;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptExecutionDTO;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptExecutionQueryDTO;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * 脚本执行记录表Mapper接口
 * 
 * @author system
 * @date 2025-01-15
 */
@Mapper
public interface DatacloudScriptExecutionMapper extends BaseMapper<DatacloudScriptExecution> {

    /**
     * 分页查询脚本执行记录列表
     * 
     * @param page 分页参数
     * @param query 查询条件
     * @return 脚本执行记录列表
     */
    List<DatacloudScriptExecutionDTO> selectScriptExecutionListByPage(Page<DatacloudScriptExecutionDTO> page, 
                                                                      @Param("query") DatacloudScriptExecutionQueryDTO query);

    /**
     * 根据脚本ID查询执行记录列表
     * 
     * @param scriptId 脚本ID
     * @param enterpriseId 企业ID
     * @param limit 限制数量
     * @return 执行记录列表
     */
    List<DatacloudScriptExecutionDTO> selectExecutionsByScriptId(@Param("scriptId") Long scriptId, 
                                                                 @Param("enterpriseId") Long enterpriseId, 
                                                                 @Param("limit") Integer limit);

    /**
     * 查询正在执行的记录
     * 
     * @param scriptId 脚本ID
     * @param enterpriseId 企业ID
     * @return 正在执行的记录列表
     */
    List<DatacloudScriptExecutionDTO> selectRunningExecutions(@Param("scriptId") Long scriptId, 
                                                              @Param("enterpriseId") Long enterpriseId);

    /**
     * 统计脚本执行次数
     * 
     * @param scriptId 脚本ID
     * @return 执行次数
     */
    int countExecutionsByScriptId(@Param("scriptId") Long scriptId);

    /**
     * 统计脚本成功执行次数
     * 
     * @param scriptId 脚本ID
     * @return 成功执行次数
     */
    int countSuccessExecutionsByScriptId(@Param("scriptId") Long scriptId);

    /**
     * 统计脚本失败执行次数
     * 
     * @param scriptId 脚本ID
     * @return 失败执行次数
     */
    int countFailedExecutionsByScriptId(@Param("scriptId") Long scriptId);

    /**
     * 获取脚本最后执行时间
     * 
     * @param scriptId 脚本ID
     * @return 最后执行时间
     */
    java.util.Date getLastExecutionTimeByScriptId(@Param("scriptId") Long scriptId);

    /**
     * 获取脚本平均执行时长
     * 
     * @param scriptId 脚本ID
     * @return 平均执行时长（毫秒）
     */
    Long getAverageExecutionDurationByScriptId(@Param("scriptId") Long scriptId);

    /**
     * 查询执行记录统计信息
     * 
     * @param enterpriseId 企业ID
     * @return 统计信息
     */
    java.util.Map<String, Object> selectExecutionStatistics(@Param("enterpriseId") Long enterpriseId);

    /**
     * 查询执行状态统计
     * 
     * @param enterpriseId 企业ID
     * @return 执行状态统计
     */
    List<java.util.Map<String, Object>> selectExecutionStatusStatistics(@Param("enterpriseId") Long enterpriseId);

    /**
     * 查询脚本执行统计
     * 
     * @param enterpriseId 企业ID
     * @param limit 限制数量
     * @return 脚本执行统计
     */
    List<java.util.Map<String, Object>> selectScriptExecutionStatistics(@Param("enterpriseId") Long enterpriseId, 
                                                                        @Param("limit") Integer limit);

    /**
     * 查询最近执行记录
     * 
     * @param enterpriseId 企业ID
     * @param limit 限制数量
     * @return 最近执行记录列表
     */
    List<DatacloudScriptExecutionDTO> selectRecentExecutions(@Param("enterpriseId") Long enterpriseId, 
                                                             @Param("limit") Integer limit);

    /**
     * 批量删除脚本执行记录
     * 
     * @param executionIds 执行记录ID列表
     * @param enterpriseId 企业ID
     * @return 删除记录数
     */
    int batchDeleteScriptExecutions(@Param("executionIds") List<Long> executionIds, 
                                   @Param("enterpriseId") Long enterpriseId);
}
