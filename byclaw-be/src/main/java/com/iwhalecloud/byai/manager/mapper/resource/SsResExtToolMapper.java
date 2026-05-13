package com.iwhalecloud.byai.manager.mapper.resource;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.dto.resource.ResourceExtToolDto;
import com.iwhalecloud.byai.manager.dto.resource.SsResExtPluginToolDto;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtTool;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.Collection;
import java.util.List;

/**
 * 插件工具扩展表Mapper接口
 */
@Mapper
public interface SsResExtToolMapper extends BaseMapper<SsResExtTool> {

    /**
     * 根据工具id查询列表并返回工具headers
     * 
     * @param ids ids 资源列表
     * @return List<SsResExtPluginToolDto>
     */
    List<SsResExtPluginToolDto> findWithHeaderByResourceIds(List<Long> ids);

    /**
     * 查询工具信息
     * 
     * @param resourceIds 资源标识
     * @return ResourceExtToolDto
     */
    List<ResourceExtToolDto> findResourceExtToolByIds(@Param("resourceIds") Collection<Long> resourceIds);

    /**
     * 根据资源ID列表批量查询工具扩展数据
     *
     * @param resourceIds 资源ID列表
     * @return 工具扩展列表
     */
    List<SsResExtTool> selectListByResourceIds(@Param("resourceIds") List<Long> resourceIds);
}