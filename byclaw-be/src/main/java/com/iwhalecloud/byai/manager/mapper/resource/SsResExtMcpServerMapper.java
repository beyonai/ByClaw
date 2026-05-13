package com.iwhalecloud.byai.manager.mapper.resource;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.dto.resource.ResourceExtMcpDto;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtMcpServer;
import java.util.Collection;
import java.util.List;

/**
 * MCP服务扩展表Mapper接口
 */
@Mapper
public interface SsResExtMcpServerMapper extends BaseMapper<SsResExtMcpServer> {

    /**
     * 查询MCP服务信息
     * 
     * @param resourceIds 资源标识
     * @return ResourceExtMcpDto
     */
    List<ResourceExtMcpDto> findResourceExtMcpByIds(@Param("resourceIds") Collection<Long> resourceIds);

}