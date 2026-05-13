package com.iwhalecloud.byai.manager.mapper.template;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.template.ResourceTemplateRelation;
import org.apache.ibatis.annotations.Param;
import java.util.List;
import java.util.Map;

/**
 * 资源模版关联关系Mapper
 * 
 * @author system &#064;date 2025-01-XX
 */
public interface ResourceTemplateRelationMapper extends BaseMapper<ResourceTemplateRelation> {

    /**
     * 根据资源ID删除关联关系
     *
     * @param resourceId 资源ID
     */
    void deleteByResourceId(@Param("resourceId") Long resourceId);

    /**
     * 根据资源ID和用户ID查询关联关系列表
     * 
     * @param resourceId 资源ID
     * @param userId 用户ID
     * @return 关联关系列表
     */
    List<ResourceTemplateRelation> selectByResourceIdAndUserId(@Param("resourceId") Long resourceId,
        @Param("userId") Long userId);

    /**
     * 批量插入关联关系
     *
     * @param relations 关联关系列表
     */
    void batchInsert(@Param("list") List<ResourceTemplateRelation> relations);

    /**
     * 根据模板ID查询关联关系列表
     *
     * @param templateId 模板ID
     * @return 关联关系列表
     */
    List<ResourceTemplateRelation> selectByTemplateId(@Param("templateId") Long templateId);

    /**
     * 根据模板ID和资源ID查询关联关系（唯一记录）
     *
     * @param templateId 模板ID
     * @param resourceId 资源ID
     * @return 关联关系，如果不存在返回null
     */
    ResourceTemplateRelation selectByTemplateIdAndResourceId(@Param("templateId") Long templateId,
        @Param("resourceId") Long resourceId);

    /**
     * 根据资源ID列表批量查询关联关系（查询resource_id和memory_rule_id字段）
     *
     * @param resourceIds 资源ID列表
     * @return 关联关系列表，包含resource_id和memory_rule_id字段
     */
    List<Map<String, Object>> selectByResourceIds(@Param("resourceIds") List<Long> resourceIds);
}
