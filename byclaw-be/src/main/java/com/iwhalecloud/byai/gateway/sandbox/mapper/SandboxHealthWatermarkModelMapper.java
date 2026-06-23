package com.iwhalecloud.byai.gateway.sandbox.mapper;

import java.util.List;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.gateway.sandbox.persistence.SandboxHealthWatermarkModelEntity;

@Mapper
public interface SandboxHealthWatermarkModelMapper extends BaseMapper<SandboxHealthWatermarkModelEntity> {

    String TABLE_NAME = "sandbox_health_watermark_model";

    String COLUMNS = "id,\n"
        + "model_name AS \"modelName\",\n"
        + "service_type AS \"serviceType\",\n"
        + "profile_key AS \"profileKey\",\n"
        + "enabled,\n"
        + "priority,\n"
        + "idle_memory_limit_ratio AS \"idleMemoryLimitRatio\",\n"
        + "busy_memory_limit_ratio AS \"busyMemoryLimitRatio\",\n"
        + "critical_memory_limit_ratio AS \"criticalMemoryLimitRatio\",\n"
        + "busy_cpu_request_ratio AS \"busyCpuRequestRatio\",\n"
        + "critical_cpu_request_ratio AS \"criticalCpuRequestRatio\",\n"
        + "consecutive_busy_samples AS \"consecutiveBusySamples\",\n"
        + "recover_samples AS \"recoverSamples\",\n"
        + "sample_interval_seconds AS \"sampleIntervalSeconds\",\n"
        + "snapshot_ttl_seconds AS \"snapshotTtlSeconds\",\n"
        + "watch_ttl_seconds AS \"watchTtlSeconds\",\n"
        + "remark,\n"
        + "created_at AS \"createdAt\",\n"
        + "updated_at AS \"updatedAt\"";

    String BASE_SELECT = "SELECT " + COLUMNS + "\nFROM " + TABLE_NAME + "\n";

    @Select("""
        <script>
        """ + BASE_SELECT + """
        <where>
        <if test="serviceType != null and serviceType != ''">
          AND service_type = #{serviceType}
        </if>
        <if test="profileKey != null and profileKey != ''">
          AND profile_key = #{profileKey}
        </if>
        <if test="enabled != null">
          AND enabled = #{enabled}
        </if>
        </where>
        ORDER BY service_type ASC, profile_key ASC NULLS FIRST, priority DESC, id DESC
        </script>
        """)
    List<SandboxHealthWatermarkModelEntity> selectModels(@Param("serviceType") String serviceType,
                                                         @Param("profileKey") String profileKey,
                                                         @Param("enabled") Integer enabled);

    @Select("""
        <script>
        """ + BASE_SELECT + """
        WHERE service_type = #{serviceType}
          AND COALESCE(profile_key, '') = COALESCE(#{profileKey}, '')
          AND enabled = 1
          <if test="excludeId != null">
            AND id != #{excludeId}
        </if>
        LIMIT 1
        </script>
        """)
    SandboxHealthWatermarkModelEntity selectEnabledPeer(@Param("serviceType") String serviceType,
                                                        @Param("profileKey") String profileKey,
                                                        @Param("excludeId") Long excludeId);

    @Select("""
        """ + BASE_SELECT + """
        WHERE service_type = #{serviceType}
          AND COALESCE(profile_key, '') = COALESCE(#{profileKey}, '')
          AND enabled = 1
        ORDER BY priority DESC, id DESC
        LIMIT 1
        """)
    SandboxHealthWatermarkModelEntity selectEnabledExact(@Param("serviceType") String serviceType,
                                                         @Param("profileKey") String profileKey);

    @Select("""
        """ + BASE_SELECT + """
        WHERE service_type = #{serviceType}
          AND COALESCE(profile_key, '') = ''
          AND enabled = 1
        ORDER BY priority DESC, id DESC
        LIMIT 1
        """)
    SandboxHealthWatermarkModelEntity selectEnabledServiceDefault(@Param("serviceType") String serviceType);

    @Select("""
        """ + BASE_SELECT + """
        WHERE service_type = 'default'
          AND COALESCE(profile_key, '') = ''
          AND enabled = 1
        ORDER BY priority DESC, id DESC
        LIMIT 1
        """)
    SandboxHealthWatermarkModelEntity selectEnabledDefault();

    @Insert("""
        INSERT INTO sandbox_health_watermark_model (
          model_name, service_type, profile_key, enabled, priority,
          idle_memory_limit_ratio, busy_memory_limit_ratio, critical_memory_limit_ratio,
          busy_cpu_request_ratio, critical_cpu_request_ratio, consecutive_busy_samples, recover_samples,
          sample_interval_seconds, snapshot_ttl_seconds, watch_ttl_seconds, remark, created_at, updated_at
        ) VALUES (
          #{modelName}, #{serviceType}, #{profileKey}, #{enabled}, #{priority},
          #{idleMemoryLimitRatio}, #{busyMemoryLimitRatio}, #{criticalMemoryLimitRatio},
          #{busyCpuRequestRatio}, #{criticalCpuRequestRatio}, #{consecutiveBusySamples}, #{recoverSamples},
          #{sampleIntervalSeconds}, #{snapshotTtlSeconds}, #{watchTtlSeconds}, #{remark}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        """)
    int insertModel(SandboxHealthWatermarkModelEntity entity);

    @Update("""
        UPDATE sandbox_health_watermark_model
        SET model_name = #{modelName},
            service_type = #{serviceType},
            profile_key = #{profileKey},
            enabled = #{enabled},
            priority = #{priority},
            idle_memory_limit_ratio = #{idleMemoryLimitRatio},
            busy_memory_limit_ratio = #{busyMemoryLimitRatio},
            critical_memory_limit_ratio = #{criticalMemoryLimitRatio},
            busy_cpu_request_ratio = #{busyCpuRequestRatio},
            critical_cpu_request_ratio = #{criticalCpuRequestRatio},
            consecutive_busy_samples = #{consecutiveBusySamples},
            recover_samples = #{recoverSamples},
            sample_interval_seconds = #{sampleIntervalSeconds},
            snapshot_ttl_seconds = #{snapshotTtlSeconds},
            watch_ttl_seconds = #{watchTtlSeconds},
            remark = #{remark},
            updated_at = CURRENT_TIMESTAMP
        WHERE id = #{id}
        """)
    int updateModel(SandboxHealthWatermarkModelEntity entity);

    @Update("""
        UPDATE sandbox_health_watermark_model
        SET enabled = #{enabled},
            updated_at = CURRENT_TIMESTAMP
        WHERE id = #{id}
        """)
    int updateEnabled(@Param("id") Long id, @Param("enabled") Integer enabled);

    @Update("""
        UPDATE sandbox_health_watermark_model
        SET enabled = 0,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = #{id}
        """)
    int disableModel(@Param("id") Long id);
}
