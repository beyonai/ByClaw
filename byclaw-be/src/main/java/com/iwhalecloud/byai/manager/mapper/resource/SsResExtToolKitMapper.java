package com.iwhalecloud.byai.manager.mapper.resource;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.dto.resource.ResourceExtToolKitDto;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtToolKit;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.Collection;
import java.util.List;

/**
 * 插件扩展表Mapper接口
 */
@Mapper
public interface SsResExtToolKitMapper extends BaseMapper<SsResExtToolKit> {

    /**
     * 查询工具集信息（包含关联的工具列表）
     * 
     * @param resourceIds 资源标识
     * @return ResourceExtToolKitDto
     */
    List<ResourceExtToolKitDto> findResourceExtToolKitByIds(@Param("resourceIds") Collection<Long> resourceIds);

    /**
     * 根据资源ID列表批量查询工具集扩展数据
     *
     * @param resourceIds 资源ID列表
     * @return 工具集扩展列表
     */
    List<SsResExtToolKit> selectListByResourceIds(@Param("resourceIds") List<Long> resourceIds);

    /**
     * 查找工具的工具集
     * 
     * @param resourceId 资源标识
     * @return Long
     */
    Long findToolKitIdByToolsId(@Param("resourceId") Long resourceId);
}