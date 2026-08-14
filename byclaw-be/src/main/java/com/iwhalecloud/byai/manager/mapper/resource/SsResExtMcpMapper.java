package com.iwhalecloud.byai.manager.mapper.resource;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtMcp;
import org.apache.ibatis.annotations.Mapper;

import java.util.Collection;
import java.util.List;

/**
 * MCP扩展表Mapper接口
 */
@Mapper
public interface SsResExtMcpMapper extends BaseMapper<SsResExtMcp> {

    /**
     * PR-3 (#150) 批量查询 MCP 扩展数据. 内部委托 MyBatis-Plus {@code selectBatchIds}
     * (单 SQL IN 子句),用于替代启动期循环 {@code findById} 触发的 N+1.
     *
     * @param resourceIds 资源ID列表(空集合时返回空 List,不会触发 SQL)
     * @return MCP 扩展列表
     */
    default List<SsResExtMcp> findByIds(Collection<Long> resourceIds) {
        if (resourceIds == null || resourceIds.isEmpty()) {
            return java.util.Collections.emptyList();
        }
        return selectBatchIds(resourceIds);
    }
}
