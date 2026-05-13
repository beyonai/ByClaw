package com.iwhalecloud.byai.manager.mapper.auth;

import com.iwhalecloud.byai.manager.dto.auth.AuthResourceType;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.qo.auth.AuthContextQo;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/**
 * @author he.duming
 * @date 2026-02-03 20:41:10
 * @description TODO
 */
@Mapper
public interface ResourceAuthContextMapper {

    List<AuthResourceType> getAuthResourceType(AuthContextQo authContextQo);

    List<SsResource> getResourceByIds(@Param("resourceIds") List<Long> resourceIds);

    List<SsResource> getDatasetByDigEmployeeIds(@Param("resourceIds") List<Long> resourceIds);
}
