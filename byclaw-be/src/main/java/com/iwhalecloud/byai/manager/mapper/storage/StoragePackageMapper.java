package com.iwhalecloud.byai.manager.mapper.storage;

import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.storage.StoragePackageEntity;

public interface StoragePackageMapper extends BaseMapper<StoragePackageEntity> {

    @Select("SELECT * FROM byai.po_storage_package WHERE package_id = #{packageId} FOR UPDATE")
    StoragePackageEntity selectByIdForUpdate(@Param("packageId") Long packageId);

    @Select("SELECT * FROM byai.po_storage_package WHERE package_code = #{packageCode} FOR UPDATE")
    StoragePackageEntity selectByCodeForUpdate(@Param("packageCode") String packageCode);

    @Select("SELECT COUNT(DISTINCT user_id) FROM byai.po_user_storage_grant "
        + "WHERE package_id = #{packageId} AND grant_status = 'ACTIVE'")
    long countActiveUsers(@Param("packageId") Long packageId);
}
