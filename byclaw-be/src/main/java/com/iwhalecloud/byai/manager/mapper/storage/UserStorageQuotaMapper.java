package com.iwhalecloud.byai.manager.mapper.storage;

import java.util.List;

import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.dto.storage.UserStorageQuotaQuery;
import com.iwhalecloud.byai.manager.entity.storage.UserStorageQuota;
import com.iwhalecloud.byai.manager.vo.storage.UserStorageQuotaAdminVO;

public interface UserStorageQuotaMapper extends BaseMapper<UserStorageQuota> {

    Page<UserStorageQuotaAdminVO> selectAdminPage(@Param("page") Page<UserStorageQuotaAdminVO> page,
        @Param("query") UserStorageQuotaQuery query);

    @Update("UPDATE byai.po_user_storage_quota "
        + "SET reserved_bytes = reserved_bytes + #{bytes}, version = version + 1, update_time = CURRENT_TIMESTAMP "
        + "WHERE user_id = #{userId} AND delete_flag = '0' "
        + "AND usage_status NOT IN ('RESETTING', 'RESTORING') "
        + "AND NOT EXISTS (SELECT 1 FROM byai.po_user_storage_downgrade downgrade "
        + "WHERE downgrade.user_id = #{userId} AND downgrade.request_type = 'CANCEL_PACKAGE' "
        + "AND downgrade.downgrade_status = 'REQUESTED') "
        + "AND used_bytes + reserved_bytes + #{bytes} <= total_quota_bytes")
    int reserveWrite(@Param("userId") Long userId, @Param("bytes") long bytes);

    @Update("UPDATE byai.po_user_storage_quota "
        + "SET reserved_bytes = GREATEST(0, reserved_bytes - #{bytes}), used_bytes = used_bytes + #{bytes}, "
        + "usage_status = CASE "
        + "WHEN used_bytes + #{bytes} >= total_quota_bytes THEN 'EXCEEDED' "
        + "WHEN (used_bytes + #{bytes}) * 100 >= total_quota_bytes * #{warningPercent} THEN 'WARNING' "
        + "ELSE 'NORMAL' END, version = version + 1, update_time = CURRENT_TIMESTAMP "
        + "WHERE user_id = #{userId} AND delete_flag = '0' AND reserved_bytes >= #{bytes}")
    int commitWrite(@Param("userId") Long userId, @Param("bytes") long bytes,
        @Param("warningPercent") int warningPercent);

    @Update("UPDATE byai.po_user_storage_quota "
        + "SET reserved_bytes = GREATEST(0, reserved_bytes - #{bytes}), version = version + 1, "
        + "update_time = CURRENT_TIMESTAMP WHERE user_id = #{userId} AND delete_flag = '0'")
    int releaseWrite(@Param("userId") Long userId, @Param("bytes") long bytes);

    @Update("UPDATE byai.po_user_storage_quota "
        + "SET used_bytes = GREATEST(0, used_bytes - #{bytes}), usage_status = CASE "
        + "WHEN usage_status IN ('RESETTING', 'RESTORING') THEN usage_status "
        + "WHEN GREATEST(0, used_bytes - #{bytes}) >= total_quota_bytes THEN 'EXCEEDED' "
        + "WHEN GREATEST(0, used_bytes - #{bytes}) * 100 >= total_quota_bytes * #{warningPercent} THEN 'WARNING' "
        + "ELSE 'NORMAL' END, version = version + 1, update_time = CURRENT_TIMESTAMP "
        + "WHERE user_id = #{userId} AND delete_flag = '0'")
    int commitDelete(@Param("userId") Long userId, @Param("bytes") long bytes,
        @Param("warningPercent") int warningPercent);

    @Select("SELECT * FROM byai.po_user_storage_quota "
        + "WHERE storage_quota_id > #{lastId} AND delete_flag = '0' "
        + "ORDER BY storage_quota_id LIMIT #{limit}")
    List<UserStorageQuota> selectScanPage(@Param("lastId") long lastId, @Param("limit") int limit);

    @Update("UPDATE byai.po_user_storage_quota SET used_bytes = #{usedBytes}, "
        + "usage_status = #{usageStatus}, last_scan_time = #{scanTime}, "
        + "last_warning_time = #{warningTime}, last_warning_status = #{warningStatus}, "
        + "last_error = #{lastError}, version = version + 1, update_time = CURRENT_TIMESTAMP "
        + "WHERE storage_quota_id = #{quotaId} AND version = #{version} AND delete_flag = '0'")
    int updateUsageIfVersion(@Param("quotaId") Long quotaId, @Param("version") Long version,
        @Param("usedBytes") long usedBytes, @Param("usageStatus") String usageStatus,
        @Param("scanTime") java.util.Date scanTime, @Param("warningTime") java.util.Date warningTime,
        @Param("warningStatus") String warningStatus, @Param("lastError") String lastError);

    @Update("UPDATE byai.po_user_storage_quota SET last_scan_time = #{scanTime}, last_error = #{lastError}, "
        + "update_time = CURRENT_TIMESTAMP WHERE storage_quota_id = #{quotaId} AND delete_flag = '0'")
    int updateScanError(@Param("quotaId") Long quotaId, @Param("scanTime") java.util.Date scanTime,
        @Param("lastError") String lastError);
}
