package com.iwhalecloud.byai.manager.mapper.storage;

import java.util.List;

import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.dto.storage.UserStorageGrantQuery;
import com.iwhalecloud.byai.manager.entity.storage.UserStorageGrant;
import com.iwhalecloud.byai.manager.vo.storage.UserStorageGrantAdminVO;

public interface UserStorageGrantMapper extends BaseMapper<UserStorageGrant> {

    Page<UserStorageGrantAdminVO> selectActiveAdminPage(
        @Param("page") Page<UserStorageGrantAdminVO> page,
        @Param("query") UserStorageGrantQuery query);

    @Select("SELECT COALESCE(SUM(granted_bytes), 0) FROM byai.po_user_storage_grant "
        + "WHERE user_id = #{userId} AND grant_status = 'ACTIVE'")
    long sumActiveBytes(@Param("userId") Long userId);

    @Select("SELECT * FROM byai.po_user_storage_grant WHERE grant_id = #{grantId} FOR UPDATE")
    UserStorageGrant selectByIdForUpdate(@Param("grantId") Long grantId);

    List<UserStorageGrantAdminVO> selectUserActiveGrants(@Param("userId") Long userId);
}
