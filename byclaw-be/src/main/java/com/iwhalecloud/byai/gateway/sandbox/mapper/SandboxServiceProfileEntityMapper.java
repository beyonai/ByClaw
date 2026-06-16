package com.iwhalecloud.byai.gateway.sandbox.mapper;

import java.util.List;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.gateway.sandbox.persistence.SandboxServiceProfileEntity;

@Mapper
public interface SandboxServiceProfileEntityMapper extends BaseMapper<SandboxServiceProfileEntity> {

    @Select("""
        SELECT id,
               service_type AS "serviceType",
               profile_key AS "profileKey",
               resource_requests AS "resourceRequests",
               resource_limits AS "resourceLimits",
               template_patch_json AS "templatePatchJson",
               resize_enabled AS "resizeEnabled",
               resize_strategy AS "resizeStrategy",
               enabled,
               sort_order AS "sortOrder"
        FROM sandbox_service_profile
        WHERE service_type = #{serviceType}
          AND profile_key = #{profileKey}
          AND enabled = 1
        LIMIT 1
        """)
    SandboxServiceProfileEntity selectEnabledProfile(@Param("serviceType") String serviceType,
                                                     @Param("profileKey") String profileKey);

    @Select("""
        SELECT id,
               service_type AS "serviceType",
               profile_key AS "profileKey",
               resource_requests AS "resourceRequests",
               resource_limits AS "resourceLimits",
               template_patch_json AS "templatePatchJson",
               resize_enabled AS "resizeEnabled",
               resize_strategy AS "resizeStrategy",
               enabled,
               sort_order AS "sortOrder"
        FROM sandbox_service_profile
        WHERE service_type = #{serviceType}
          AND enabled = 1
        ORDER BY sort_order ASC, profile_key ASC
        """)
    List<SandboxServiceProfileEntity> selectEnabledProfiles(@Param("serviceType") String serviceType);

    @Select("""
        <script>
        SELECT id,
               service_type AS "serviceType",
               profile_key AS "profileKey",
               resource_requests AS "resourceRequests",
               resource_limits AS "resourceLimits",
               template_patch_json AS "templatePatchJson",
               resize_enabled AS "resizeEnabled",
               resize_strategy AS "resizeStrategy",
               enabled,
               sort_order AS "sortOrder"
        FROM sandbox_service_profile
        WHERE 1 = 1
        <if test="serviceType != null and serviceType != ''">
          AND service_type = #{serviceType}
        </if>
        <if test="enabledOnly">
          AND enabled = 1
        </if>
        ORDER BY service_type ASC, sort_order ASC, profile_key ASC
        </script>
        """)
    List<SandboxServiceProfileEntity> selectProfiles(@Param("serviceType") String serviceType,
                                                     @Param("enabledOnly") boolean enabledOnly);

    @Select("""
        SELECT id,
               service_type AS "serviceType",
               profile_key AS "profileKey",
               resource_requests AS "resourceRequests",
               resource_limits AS "resourceLimits",
               template_patch_json AS "templatePatchJson",
               resize_enabled AS "resizeEnabled",
               resize_strategy AS "resizeStrategy",
               enabled,
               sort_order AS "sortOrder"
        FROM sandbox_service_profile
        WHERE service_type = #{serviceType}
          AND profile_key = #{profileKey}
        LIMIT 1
        """)
    SandboxServiceProfileEntity selectProfile(@Param("serviceType") String serviceType,
                                              @Param("profileKey") String profileKey);

    @Insert("""
        INSERT INTO sandbox_service_profile (
            service_type, profile_key, resource_requests, resource_limits,
            template_patch_json, resize_enabled, resize_strategy, enabled, sort_order, updated_at
        ) VALUES (
            #{serviceType}, #{profileKey}, #{resourceRequests}::jsonb, #{resourceLimits}::jsonb,
            #{templatePatchJson}::jsonb, #{resizeEnabled}, #{resizeStrategy}, #{enabled}, #{sortOrder},
            CURRENT_TIMESTAMP
        )
        """)
    int insertProfile(SandboxServiceProfileEntity entity);

    @Update("""
        UPDATE sandbox_service_profile
        SET resource_requests = #{resourceRequests}::jsonb,
            resource_limits = #{resourceLimits}::jsonb,
            template_patch_json = #{templatePatchJson}::jsonb,
            resize_enabled = #{resizeEnabled},
            resize_strategy = #{resizeStrategy},
            enabled = #{enabled},
            sort_order = #{sortOrder},
            updated_at = CURRENT_TIMESTAMP
        WHERE id = #{id}
        """)
    int updateProfile(SandboxServiceProfileEntity entity);

    @Update("""
        UPDATE sandbox_service_profile
        SET enabled = 0,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = #{id}
        """)
    int disableProfile(@Param("id") Long id);
}
