package com.iwhalecloud.byai.manager.mapper.storage;

import java.util.List;

import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.dto.storage.UserStorageDowngradeQuery;
import com.iwhalecloud.byai.manager.entity.storage.UserStorageDowngrade;
import com.iwhalecloud.byai.manager.vo.storage.UserStorageDowngradeAdminVO;

public interface UserStorageDowngradeMapper extends BaseMapper<UserStorageDowngrade> {

    @Select("SELECT * FROM byai.po_user_storage_downgrade WHERE downgrade_id = #{downgradeId} FOR UPDATE")
    UserStorageDowngrade selectByIdForUpdate(@Param("downgradeId") Long downgradeId);

    @Select("SELECT COUNT(*) FROM byai.po_user_storage_downgrade "
        + "WHERE grant_id = #{grantId} AND downgrade_status IN ('REQUESTED', 'GRACE', 'ARCHIVING')")
    long countOpenByGrantId(@Param("grantId") Long grantId);

    @Select("SELECT COUNT(*) FROM byai.po_user_storage_downgrade "
        + "WHERE user_id = #{userId} AND downgrade_status IN ('REQUESTED', 'GRACE', 'ARCHIVING')")
    long countOpenByUserId(@Param("userId") Long userId);

    @Select("SELECT COUNT(*) FROM byai.po_user_storage_downgrade "
        + "WHERE user_id = #{userId} AND request_type = 'CANCEL_PACKAGE' AND downgrade_status = 'REQUESTED'")
    long countWriteBlockingByUserId(@Param("userId") Long userId);

    @Update("UPDATE byai.po_user_storage_downgrade SET downgrade_status = 'ARCHIVING', error_message = NULL "
        + "WHERE downgrade_id = #{downgradeId} AND downgrade_status = 'GRACE'")
    int claimArchiving(@Param("downgradeId") Long downgradeId);

    @Update("UPDATE byai.po_user_storage_downgrade SET downgrade_status = 'COMPLETED', "
        + "completed_time = #{completedTime}, error_message = NULL "
        + "WHERE downgrade_id = #{downgradeId} AND downgrade_status = 'GRACE'")
    int completeGrace(@Param("downgradeId") Long downgradeId, @Param("completedTime") java.util.Date completedTime);

    Page<UserStorageDowngradeAdminVO> selectAdminPage(
        @Param("page") Page<UserStorageDowngradeAdminVO> page,
        @Param("query") UserStorageDowngradeQuery query);

    Page<UserStorageDowngradeAdminVO> selectUserPage(
        @Param("page") Page<UserStorageDowngradeAdminVO> page,
        @Param("userId") Long userId,
        @Param("query") UserStorageDowngradeQuery query);

    List<UserStorageDowngradeAdminVO> selectUserHistory(@Param("userId") Long userId);
}
