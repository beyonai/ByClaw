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

}