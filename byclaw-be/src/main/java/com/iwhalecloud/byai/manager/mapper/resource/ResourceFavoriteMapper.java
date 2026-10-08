package com.iwhalecloud.byai.manager.mapper.resource;

import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import org.apache.ibatis.annotations.Param;

public interface ResourceFavoriteMapper {
    boolean isSchemaReady();

    SsResource selectResource(@Param("resourceId") Long resourceId, @Param("tenantId") Long tenantId);

    int ensureCount(@Param("resourceId") Long resourceId, @Param("tenantId") Long tenantId);

    long lockCount(@Param("resourceId") Long resourceId, @Param("tenantId") Long tenantId);

    int insertFavorite(@Param("resourceId") Long resourceId, @Param("tenantId") Long tenantId,
                       @Param("userId") Long userId);

    int deleteFavorite(@Param("resourceId") Long resourceId, @Param("tenantId") Long tenantId,
                       @Param("userId") Long userId);

    int updateCount(@Param("resourceId") Long resourceId, @Param("tenantId") Long tenantId,
                    @Param("delta") int delta);
}
