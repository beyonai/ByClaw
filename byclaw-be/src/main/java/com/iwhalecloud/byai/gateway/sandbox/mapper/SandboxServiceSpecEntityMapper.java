package com.iwhalecloud.byai.gateway.sandbox.mapper;

import java.util.List;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.gateway.sandbox.persistence.SandboxServiceSpecEntity;

@Mapper
public interface SandboxServiceSpecEntityMapper extends BaseMapper<SandboxServiceSpecEntity> {

    @Select("""
        SELECT service_key AS "serviceKey",
               spec_json AS "specJson",
               template_json AS "templateJson"
        FROM sandbox_service_spec
        WHERE service_key = #{serviceKey}
        LIMIT 1
        """)
    SandboxServiceSpecEntity selectLegacyByServiceKey(@Param("serviceKey") String serviceKey);

    @Select("""
        SELECT service_key AS "serviceKey",
               spec_json AS "specJson",
               template_json AS "templateJson",
               service_type AS "serviceType",
               display_name AS "displayName",
               enabled,
               default_profile_key AS "defaultProfileKey",
               autoscale_enabled AS "autoscaleEnabled"
        FROM sandbox_service_spec
        WHERE service_key = #{serviceKey}
        LIMIT 1
        """)
    SandboxServiceSpecEntity selectProfileAwareByServiceKey(@Param("serviceKey") String serviceKey);

    @Select("""
        SELECT service_key AS "serviceKey",
               spec_json AS "specJson",
               template_json AS "templateJson",
               service_type AS "serviceType",
               display_name AS "displayName",
               enabled,
               default_profile_key AS "defaultProfileKey",
               autoscale_enabled AS "autoscaleEnabled"
        FROM sandbox_service_spec
        WHERE service_type = #{serviceType}
        ORDER BY service_key ASC
        LIMIT 1
        """)
    SandboxServiceSpecEntity selectProfileAwareByServiceType(@Param("serviceType") String serviceType);

    @Select("""
        SELECT service_key AS "serviceKey",
               spec_json AS "specJson",
               template_json AS "templateJson",
               service_type AS "serviceType",
               display_name AS "displayName",
               enabled,
               default_profile_key AS "defaultProfileKey",
               autoscale_enabled AS "autoscaleEnabled"
        FROM sandbox_service_spec
        WHERE COALESCE(enabled, 1) = 1
        ORDER BY service_key ASC
        """)
    List<SandboxServiceSpecEntity> selectAutoStartSpecs();

    /**
     * 插入沙箱服务规格配置（处理 PostgreSQL jsonb 类型）
     */
    @Insert("INSERT INTO sandbox_service_spec (service_key, spec_json, template_json, enabled) " +
            "VALUES (#{serviceKey}, #{specJson}::jsonb, #{templateJson}::jsonb, #{enabled})")
    int insertSpec(@Param("serviceKey") String serviceKey,
                   @Param("specJson") String specJson,
                   @Param("templateJson") String templateJson,
                   @Param("enabled") Integer enabled);

    /**
     * 更新沙箱服务规格配置（处理 PostgreSQL jsonb 类型）
     */
    @Update("UPDATE sandbox_service_spec " +
            "SET spec_json = #{specJson}::jsonb, template_json = #{templateJson}::jsonb, enabled = #{enabled} " +
            "WHERE service_key = #{serviceKey}")
    int updateSpec(@Param("serviceKey") String serviceKey,
                   @Param("specJson") String specJson,
                   @Param("templateJson") String templateJson,
                   @Param("enabled") Integer enabled);
}
