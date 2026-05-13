package com.iwhalecloud.byai.manager.mapper.datacloud;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.entity.datacloud.DatacloudScriptCategory;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptCategoryDTO;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptCategoryQueryDTO;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * 脚本分类表Mapper接口
 * 
 * @author system
 * @date 2025-01-15
 */
@Mapper
public interface DatacloudScriptCategoryMapper extends BaseMapper<DatacloudScriptCategory> {

    /**
     * 分页查询脚本分类列表
     * 
     * @param page 分页参数
     * @param query 查询条件
     * @return 脚本分类列表
     */
    List<DatacloudScriptCategoryDTO> selectScriptCategoryListByPage(Page<DatacloudScriptCategoryDTO> page, 
                                                                     @Param("query") DatacloudScriptCategoryQueryDTO query);

    /**
     * 查询脚本分类树形结构
     * 
     * @param enterpriseId 企业ID
     * @return 脚本分类树形列表
     */
    List<DatacloudScriptCategoryDTO> selectScriptCategoryTree(@Param("enterpriseId") Long enterpriseId);

    /**
     * 根据父分类ID查询子分类列表
     * 
     * @param parentId 父分类ID
     * @param enterpriseId 企业ID
     * @return 子分类列表
     */
    List<DatacloudScriptCategoryDTO> selectChildCategories(@Param("parentId") Long parentId, 
                                                            @Param("enterpriseId") Long enterpriseId);

    /**
     * 检查分类编码是否存在
     * 
     * @param categoryCode 分类编码
     * @param enterpriseId 企业ID
     * @param excludeId 排除的分类ID（用于更新时检查）
     * @return 存在的记录数
     */
    int checkCategoryCodeExists(@Param("categoryCode") String categoryCode, 
                                @Param("enterpriseId") Long enterpriseId, 
                                @Param("excludeId") Long excludeId);

    /**
     * 统计分类下的脚本数量
     * 
     * @param categoryId 分类ID
     * @return 脚本数量
     */
    int countScriptsByCategory(@Param("categoryId") Long categoryId);

    /**
     * 统计分类下的子分类数量
     * 
     * @param categoryId 分类ID
     * @return 子分类数量
     */
    int countChildCategories(@Param("categoryId") Long categoryId);

    /**
     * 查询分类统计信息
     * 
     * @param enterpriseId 企业ID
     * @return 统计信息
     */
    java.util.Map<String, Object> selectCategoryStatistics(@Param("enterpriseId") Long enterpriseId);

    /**
     * 批量删除脚本分类
     * 
     * @param categoryIds 分类ID列表
     * @param enterpriseId 企业ID
     * @return 删除记录数
     */
    int batchDeleteScriptCategories(@Param("categoryIds") List<Long> categoryIds, 
                                   @Param("enterpriseId") Long enterpriseId);
}
