package com.iwhalecloud.byai.manager.mapper.template;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.entity.template.TemplateRuleInfo;
import com.iwhalecloud.byai.manager.qo.template.TemplateRuleInfoQueryQo;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

/**
 * 模版规则信息Mapper
 * 
 * @author system
 * @date 2025-01-XX
 */
@Mapper
public interface TemplateRuleInfoMapper extends BaseMapper<TemplateRuleInfo> {

    /**
     * 根据条件查询模版规则信息列表（分页）
     * 
     * @param page 分页对象（MyBatis Plus 会自动处理分页）
     * @param queryQo 查询条件
     * @return 分页结果（通过 Page 对象返回）
     */
    Page<TemplateRuleInfo> selectByCondition(Page<TemplateRuleInfo> page,
        @Param("queryQo") TemplateRuleInfoQueryQo queryQo);

    /**
     * 根据资源ID和用户ID查询模版规则信息列表
     * 
     * @param resourceId 资源ID
     * @param userId 用户ID
     * @return 模版规则信息列表
     */
    List<TemplateRuleInfo> selectByResourceIdAndUserId(@Param("resourceId") Long resourceId,
        @Param("userId") Long userId);

    /**
     * 根据条件查询模版规则信息列表（返回Map，包含memory_rule_id）
     * 
     * @param page 分页对象（MyBatis Plus 会自动处理分页）
     * @param queryQo 查询条件
     * @return Map列表
     */
    List<Map<String, Object>> selectByConditionWithMemoryRuleId(Page<Map<String, Object>> page,
        @Param("queryQo") TemplateRuleInfoQueryQo queryQo);

    /**
     * 根据资源ID查询关联关系（只查询memory_rule_id字段）
     *
     * @param resourceId 资源ID
     * @return 关联关系列表，包含memory_rule_id字段
     */
    List<Map<String, Object>> selectByResourceId(@Param("resourceId") Long resourceId);

    /**
     * 根据资源ID列表批量查询关联关系（查询resource_id和memory_rule_id字段）
     *
     * @param resourceIds 资源ID列表
     * @return 关联关系列表，包含resource_id和memory_rule_id字段
     */
    List<Map<String, Object>> selectByResourceIds(@Param("resourceIds") List<Long> resourceIds);
}
