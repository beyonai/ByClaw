package com.iwhalecloud.byai.gateway.sandbox.mapper;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.gateway.sandbox.persistence.SandboxServiceSpecEntity;

@Mapper
public interface SandboxServiceSpecEntityMapper extends BaseMapper<SandboxServiceSpecEntity> {

    /**
     * 插入沙箱服务规格配置（处理 PostgreSQL jsonb 类型）
     */
    @Insert("INSERT INTO sandbox_service_spec (service_key, spec_json, template_json) " +
            "VALUES (#{serviceKey}, #{specJson}::jsonb, #{templateJson}::jsonb)")
    int insertSpec(@Param("serviceKey") String serviceKey,
                   @Param("specJson") String specJson,
                   @Param("templateJson") String templateJson);

    /**
     * 更新沙箱服务规格配置（处理 PostgreSQL jsonb 类型）
     */
    @Update("UPDATE sandbox_service_spec " +
            "SET spec_json = #{specJson}::jsonb, template_json = #{templateJson}::jsonb " +
            "WHERE service_key = #{serviceKey}")
    int updateSpec(@Param("serviceKey") String serviceKey,
                   @Param("specJson") String specJson,
                   @Param("templateJson") String templateJson);
}
