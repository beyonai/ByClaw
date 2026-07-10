package com.iwhalecloud.byai.manager.mapper.resource;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.dto.resource.ResourceExtAgentDto;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtAgent;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.Collection;
import java.util.List;

/**
 * 数字员工扩展表Mapper接口
 */
@Mapper
public interface SsResExtAgentMapper extends BaseMapper<SsResExtAgent> {

    /**
     * 查询智能体信息
     * 
     * @param resourceIds 资源标识
     * @return ResourceExtAgentDto
     */
    List<ResourceExtAgentDto> findResourceExtAgentByIds(@Param("resourceIds") Collection<Long> resourceIds);

    /**
     * PR-3 (#150) 批量查询智能体扩展数据. 内部委托 MyBatis-Plus {@code selectBatchIds}
     * (单 SQL IN 子句),用于替代启动期循环 {@code findById} 触发的 N+1.
     *
     * @param resourceIds 资源ID列表(空集合时返回空 List,不会触发 SQL)
     * @return 智能体扩展列表
     */
    default List<SsResExtAgent> findByIds(Collection<Long> resourceIds) {
        if (resourceIds == null || resourceIds.isEmpty()) {
            return java.util.Collections.emptyList();
        }
        return selectBatchIds(resourceIds);
    }

}