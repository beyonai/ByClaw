package com.iwhalecloud.byai.manager.mapper.aimodel;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelRequest;
import com.iwhalecloud.byai.manager.entity.aimodel.ByaiAimodel;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/**
 * 模型定义表 Mapper
 *
 * @author system
 */
@Mapper
public interface ByaiAimodelMapper extends BaseMapper<ByaiAimodel> {

    /**
     * 按条件查询模型列表（不分页；配合 PageHelper.startPage 使用，由 PageHelper 自动分页）
     *
     * @param status 状态（API: ENABLED/DISABLED/TESTING 或 DB: OOA/OOX/OOD）
     * @param ability 能力（匹配 in_params）
     * @param system 系统（匹配 in_params）
     * @param modelId 模型ID
     * @param modelName 模型名称模糊
     * @param keyword 关键字（displayName/modelCode/providerName）
     * @return 列表
     */
    List<ByaiAimodel> selectByCondition(@Param("status") String status, @Param("ability") Long ability,
        @Param("system") String system, @Param("modelId") Long modelId, @Param("modelName") String modelName,
        @Param("keyword") String keyword);

    /**
     * 统计符合条件的总数
     */
    long countByCondition(@Param("status") String status, @Param("ability") String ability,
        @Param("system") String system, @Param("modelId") Long modelId, @Param("modelName") String modelName,
        @Param("keyword") String keyword);

    /**
     * 按模型名称统计条数；excludeModelId 不为空时排除该 id（用于修改时校验其他记录是否占用名称）
     *
     * @param modelName 模型名称（displayName 对应 model_name），精确匹配
     * @param excludeModelId 排除的模型 ID，为 null 时统计所有同名（用于新增校验）
     * @return 同名记录数
     */
    long countByModelNameExcludeId(@Param("modelName") String modelName, @Param("excludeModelId") Long excludeModelId);

    List<ByaiAimodel> listModel(ModelRequest request);

    List<ByaiAimodel> listModelInner(ModelRequest request);

}
