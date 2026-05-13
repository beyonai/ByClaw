package com.iwhalecloud.byai.manager.mapper.memory;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.memory.ResourceRuleEnabled;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * 资源规则启用状态Mapper
 * 
 * @author system &#064;date 2025-01-XX
 */
public interface ResourceRuleEnabledMapper extends BaseMapper<ResourceRuleEnabled> {

    /**
     * 插入资源规则启用状态
     * 
     * @param record 资源规则启用状态
     * @return 影响行数
     */
    int insert(ResourceRuleEnabled record);

    /**
     * 根据主键更新
     * 
     * @param record 资源规则启用状态
     * @return 影响行数
     */
    int updateById(ResourceRuleEnabled record);

    /**
     * 根据主键删除
     *
     * @param resourceTemplateId 资源模版关联ID
     */
    void deleteById(@Param("resourceTemplateId") Long resourceTemplateId);

    /**
     * 根据资源ID、模版ID和用户ID查询
     * 
     * @param resourceId 资源ID
     * @param templateId 模版ID
     * @param userId 用户ID
     * @return 资源规则启用状态
     */
    ResourceRuleEnabled selectByResourceIdAndTemplateIdAndUserId(@Param("resourceId") Long resourceId,
        @Param("templateId") Long templateId, @Param("userId") Long userId);

    /**
     * 根据资源ID和用户ID查询所有关闭状态的记录
     * 
     * @param resourceId 资源ID
     * @param userId 用户ID
     * @return 资源规则启用状态列表
     */
    List<ResourceRuleEnabled> selectDisabledByResourceIdAndUserId(@Param("resourceId") Long resourceId,
        @Param("userId") Long userId);
}
