package com.iwhalecloud.byai.manager.mapper.datacloud;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.entity.datacloud.DatacloudScript;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptDTO;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptQueryDTO;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * 脚本主表Mapper接口
 * 
 * @author system
 * @date 2025-01-15
 */
@Mapper
public interface DatacloudScriptMapper extends BaseMapper<DatacloudScript> {

    /**
     * 分页查询脚本列表
     * 
     * @param page 分页参数
     * @param query 查询条件
     * @return 脚本列表
     */
    List<DatacloudScriptDTO> selectScriptListByPage(Page<DatacloudScriptDTO> page, 
                                                    @Param("query") DatacloudScriptQueryDTO query);

    /**
     * 根据场景ID查询脚本列表
     * 
     * @param scenarioId 场景ID
     * @param enterpriseId 企业ID
     * @return 脚本列表
     */
    List<DatacloudScriptDTO> selectScriptsByScenario(@Param("scenarioId") Long scenarioId, 
                                                    @Param("enterpriseId") Long enterpriseId);

    /**
     * 根据分类ID查询脚本列表
     * 
     * @param categoryId 分类ID
     * @param enterpriseId 企业ID
     * @return 脚本列表
     */
    List<DatacloudScriptDTO> selectScriptsByCategory(@Param("categoryId") Long categoryId, 
                                                     @Param("enterpriseId") Long enterpriseId);

    /**
     * 查询模板脚本列表
     * 
     * @param scriptType 脚本类型
     * @param enterpriseId 企业ID
     * @return 模板脚本列表
     */
    List<DatacloudScriptDTO> selectTemplateScripts(@Param("scriptType") String scriptType, 
                                                   @Param("enterpriseId") Long enterpriseId);

    /**
     * 根据标签查询脚本列表
     * 
     * @param tags 标签
     * @param enterpriseId 企业ID
     * @return 脚本列表
     */
    List<DatacloudScriptDTO> selectScriptsByTags(@Param("tags") String tags, 
                                                 @Param("enterpriseId") Long enterpriseId);

    /**
     * 统计脚本执行次数
     * 
     * @param scriptId 脚本ID
     * @return 执行次数
     */
    int countScriptExecutions(@Param("scriptId") Long scriptId);

    /**
     * 统计脚本成功执行次数
     * 
     * @param scriptId 脚本ID
     * @return 成功执行次数
     */
    int countScriptSuccessExecutions(@Param("scriptId") Long scriptId);

    /**
     * 获取脚本最后执行时间
     * 
     * @param scriptId 脚本ID
     * @return 最后执行时间
     */
    java.util.Date getScriptLastExecutionTime(@Param("scriptId") Long scriptId);

    /**
     * 查询热门脚本列表（按执行次数排序）
     * 
     * @param enterpriseId 企业ID
     * @param limit 限制数量
     * @return 热门脚本列表
     */
    List<DatacloudScriptDTO> selectPopularScripts(@Param("enterpriseId") Long enterpriseId, 
                                                  @Param("limit") Integer limit);

    /**
     * 查询最近创建的脚本列表
     * 
     * @param enterpriseId 企业ID
     * @param limit 限制数量
     * @return 最近创建的脚本列表
     */
    List<DatacloudScriptDTO> selectRecentScripts(@Param("enterpriseId") Long enterpriseId, 
                                                @Param("limit") Integer limit);

    /**
     * 查询脚本统计信息
     * 
     * @param enterpriseId 企业ID
     * @return 统计信息
     */
    java.util.Map<String, Object> selectScriptStatistics(@Param("enterpriseId") Long enterpriseId);

    /**
     * 批量删除脚本
     * 
     * @param scriptIds 脚本ID列表
     * @param enterpriseId 企业ID
     * @return 删除记录数
     */
    int batchDeleteScripts(@Param("scriptIds") List<Long> scriptIds, 
                          @Param("enterpriseId") Long enterpriseId);
}
