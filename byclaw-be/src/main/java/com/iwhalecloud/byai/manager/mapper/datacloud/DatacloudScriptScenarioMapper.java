package com.iwhalecloud.byai.manager.mapper.datacloud;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.entity.datacloud.DatacloudScriptScenario;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptScenarioDTO;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptScenarioQueryDTO;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * 脚本场景表Mapper接口
 * 
 * @author system
 * @date 2025-01-15
 */
@Mapper
public interface DatacloudScriptScenarioMapper extends BaseMapper<DatacloudScriptScenario> {

    /**
     * 分页查询脚本场景列表
     * 
     * @param page 分页参数
     * @param query 查询条件
     * @return 脚本场景列表
     */
    List<DatacloudScriptScenarioDTO> selectScenarioListByPage(Page<DatacloudScriptScenarioDTO> page,
                                                              @Param("query") DatacloudScriptScenarioQueryDTO query);

    /**
     * 查询脚本场景树形结构
     * 
     * @param enterpriseId 企业ID
     * @return 脚本场景树形列表
     */
    List<DatacloudScriptScenarioDTO> selectScenarioTree(@Param("enterpriseId") Long enterpriseId);

    /**
     * 根据父场景ID查询子场景列表
     * 
     * @param parentId 父场景ID
     * @param enterpriseId 企业ID
     * @return 子场景列表
     */
    List<DatacloudScriptScenarioDTO> selectChildScenarios(@Param("parentId") Long parentId, 
                                                          @Param("enterpriseId") Long enterpriseId);

    /**
     * 检查场景编码是否存在
     * 
     * @param scenarioCode 场景编码
     * @param enterpriseId 企业ID
     * @param excludeId 排除的场景ID（用于更新时检查）
     * @return 存在的记录数
     */
    int checkScenarioCodeExists(@Param("scenarioCode") String scenarioCode, 
                              @Param("enterpriseId") Long enterpriseId, 
                              @Param("excludeId") Long excludeId);

    /**
     * 统计场景下的脚本数量
     * 
     * @param scenarioId 场景ID
     * @return 脚本数量
     */
    int countScriptsByScenario(@Param("scenarioId") Long scenarioId);

    /**
     * 统计场景下的子场景数量
     * 
     * @param scenarioId 场景ID
     * @return 子场景数量
     */
    int countChildScenarios(@Param("scenarioId") Long scenarioId);

    /**
     * 批量删除脚本场景
     * 
     * @param scenarioIds 场景ID列表
     * @param enterpriseId 企业ID
     * @return 删除记录数
     */
    int batchDeleteScenarios(@Param("scenarioIds") List<Long> scenarioIds, 
                            @Param("enterpriseId") Long enterpriseId);
}
