package com.iwhalecloud.byai.manager.mapper.resource;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.dto.resource.ResourceExtDbDto;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDb;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.Collection;
import java.util.List;

/**
 * 数据库扩展表Mapper接口
 */
@Mapper
public interface SsResExtDbMapper extends BaseMapper<SsResExtDb> {

    /**
     * 查询数据库知识库信息
     * 
     * @param resourceIds 资源标识
     * @return ResourceExtDbDto
     */
    List<ResourceExtDbDto> findResourceExtDbByIds(@Param("resourceIds") Collection<Long> resourceIds);

}