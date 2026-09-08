package com.iwhalecloud.byai.manager.mapper.aimodel;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelRequest;
import com.iwhalecloud.byai.manager.entity.aimodel.ByaiAimodel;
import java.util.List;

import com.iwhalecloud.byai.manager.qo.aimodel.DefaultAiModelQo;
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
     * @param modelType 模型类型
     * @param ability 能力（匹配 in_params）
     * @param system 系统（匹配 in_params）
     * @param modelId 模型ID
     * @param modelName 模型名称模糊
     * @param keyword 关键字（displayName/modelCode/providerName）
     * @return 列表
     */
    List<ByaiAimodel> selectByCondition(@Param("status") String status, @Param("modelType") String modelType,
        @Param("ability") Long ability, @Param("system") String system, @Param("modelId") Long modelId,
        @Param("modelName") String modelName, @Param("keyword") String keyword, @Param("createBy") Long createBy,
        @Param("ownerType") String ownerType);

    /**
     * 按标签等条件查询模型列表。
     *
     * @param request 查询条件
     * @return 模型列表
     */
    List<ByaiAimodel> listModel(ModelRequest request);

    /**
     * 查询默认模型
     *
     * @param defaultAiModelQo 查询条件
     * @return ByaiAimodel
     */
    List<ByaiAimodel> listDefaultAiModel(DefaultAiModelQo defaultAiModelQo);
}
