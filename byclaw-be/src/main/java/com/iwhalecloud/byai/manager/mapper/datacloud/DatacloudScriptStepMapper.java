package com.iwhalecloud.byai.manager.mapper.datacloud;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.entity.datacloud.DatacloudScriptStep;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptStepDTO;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptStepQueryDTO;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * 脚本步骤表Mapper接口
 * 
 * @author system
 * @date 2025-01-15
 */
@Mapper
public interface DatacloudScriptStepMapper extends BaseMapper<DatacloudScriptStep> {

    /**
     * 分页查询脚本步骤列表
     * 
     * @param page 分页参数
     * @param query 查询条件
     * @return 脚本步骤列表
     */
    List<DatacloudScriptStepDTO> selectScriptStepListByPage(Page<DatacloudScriptStepDTO> page, 
                                                           @Param("query") DatacloudScriptStepQueryDTO query);

    /**
     * 根据脚本ID查询步骤列表
     * 
     * @param scriptId 脚本ID
     * @param enterpriseId 企业ID
     * @return 步骤列表
     */
    List<DatacloudScriptStepDTO> selectStepsByScriptId(@Param("scriptId") Long scriptId, 
                                                      @Param("enterpriseId") Long enterpriseId);

    /**
     * 根据脚本ID和步骤类型查询步骤列表
     * 
     * @param scriptId 脚本ID
     * @param stepType 步骤类型
     * @param enterpriseId 企业ID
     * @return 步骤列表
     */
    List<DatacloudScriptStepDTO> selectStepsByScriptIdAndType(@Param("scriptId") Long scriptId, 
                                                              @Param("stepType") String stepType, 
                                                              @Param("enterpriseId") Long enterpriseId);

    /**
     * 统计脚本的步骤数量
     * 
     * @param scriptId 脚本ID
     * @return 步骤数量
     */
    int countStepsByScriptId(@Param("scriptId") Long scriptId);

    /**
     * 获取脚本的最大步骤顺序
     * 
     * @param scriptId 脚本ID
     * @return 最大步骤顺序
     */
    Integer getMaxStepOrderByScriptId(@Param("scriptId") Long scriptId);

    /**
     * 批量更新步骤顺序
     * 
     * @param scriptId 脚本ID
     * @param stepOrders 步骤顺序映射（stepId -> stepOrder）
     * @return 更新记录数
     */
    int batchUpdateStepOrder(@Param("scriptId") Long scriptId, 
                            @Param("stepOrders") java.util.Map<Long, Integer> stepOrders);

    /**
     * 查询步骤统计信息
     * 
     * @param scriptId 脚本ID
     * @return 统计信息
     */
    java.util.Map<String, Object> selectStepStatistics(@Param("scriptId") Long scriptId);

    /**
     * 查询步骤类型统计
     * 
     * @param scriptId 脚本ID
     * @return 步骤类型统计
     */
    List<java.util.Map<String, Object>> selectStepTypeStatistics(@Param("scriptId") Long scriptId);

    /**
     * 批量删除脚本步骤
     * 
     * @param stepIds 步骤ID列表
     * @param scriptId 脚本ID
     * @return 删除记录数
     */
    int batchDeleteScriptSteps(@Param("stepIds") List<Long> stepIds, 
                              @Param("scriptId") Long scriptId);

}
