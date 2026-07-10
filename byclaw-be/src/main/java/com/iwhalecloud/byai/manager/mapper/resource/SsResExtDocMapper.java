package com.iwhalecloud.byai.manager.mapper.resource;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.dto.resource.ResourceExtDocDto;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDoc;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.Collection;
import java.util.List;

/**
 * 文档库扩展表Mapper接口
 */
@Mapper
public interface SsResExtDocMapper extends BaseMapper<SsResExtDoc> {

    /**
     * 根据资源标识查询文档库信息
     *
     * @param resourceIds 资源标识集合
     * @return 文档库资源扩展信息列表
     */
    List<ResourceExtDocDto> findResourceExtDocByIds(@Param("resourceIds") Collection<Long> resourceIds);

    /**
     * 根据资源ID列表批量查询文档库扩展数据
     *
     * @param resourceIds 资源ID列表
     * @return 文档库扩展列表
     */
    List<SsResExtDoc> selectListByResourceIds(@Param("resourceIds") List<Long> resourceIds);

    /**
     * PR-3 (#150) 批量查询文档库扩展数据. 内部委托 MyBatis-Plus {@code selectBatchIds}
     * (单 SQL IN 子句),用于替代启动期循环 {@code findById} 触发的 N+1.
     *
     * @param resourceIds 资源ID列表(空集合时返回空 List,不会触发 SQL)
     * @return 文档库扩展列表
     */
    default List<SsResExtDoc> findByIds(Collection<Long> resourceIds) {
        if (resourceIds == null || resourceIds.isEmpty()) {
            return java.util.Collections.emptyList();
        }
        return selectBatchIds(resourceIds);
    }
}