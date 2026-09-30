package com.iwhalecloud.byai.manager.mapper.resource;

/**
 * @author qin.guoquan
 * @date 2026-09-27 22:38:38
 */

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.resource.DigitalEmployeePublication;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface DigitalEmployeePublicationMapper extends BaseMapper<DigitalEmployeePublication> {
    @Select("select * from byai.ss_resource where resource_id = #{id} and com_acct_id = #{tenantId} for update")
    SsResource lockResource(@Param("id") Long id, @Param("tenantId") Long tenantId);

    @Select("select user_name from byai.po_users where user_id = #{id}")
    String creatorName(@Param("id") Long id);

    @Select("select * from byai.digital_employee_publication where request_id = #{id} and tenant_id = #{tenantId} for update")
    DigitalEmployeePublication lock(@Param("id") Long id, @Param("tenantId") Long tenantId);

    @Select("select * from byai.ss_resource where publication_source_id = #{sourceId} and com_acct_id = #{tenantId}")
    SsResource official(@Param("sourceId") Long sourceId, @Param("tenantId") Long tenantId);

    @Select("select * from byai.digital_employee_publication where source_id = #{sourceId} and tenant_id = #{tenantId} "
        + "and status in ('DRAFT','PENDING','APPLYING','FAILED') order by created_at desc limit 1")
    DigitalEmployeePublication active(@Param("sourceId") Long sourceId, @Param("tenantId") Long tenantId);

    @Select("select * from byai.digital_employee_publication where source_id = #{sourceId} and tenant_id = #{tenantId} "
        + "order by case when status in ('DRAFT','PENDING','APPLYING','FAILED') then 0 else 1 end, created_at desc, request_id desc limit 1")
    DigitalEmployeePublication current(@Param("sourceId") Long sourceId, @Param("tenantId") Long tenantId);

    @Select("select * from byai.digital_employee_publication where source_id = #{sourceId} and tenant_id = #{tenantId} "
        + "and status = 'REJECTED' and (created_at < #{createdAt} or (created_at = #{createdAt} and request_id < #{requestId})) "
        + "order by created_at desc, request_id desc limit 1")
    DigitalEmployeePublication previousRejection(@Param("sourceId") Long sourceId, @Param("tenantId") Long tenantId,
        @Param("createdAt") java.util.Date createdAt, @Param("requestId") Long requestId);

    @Select({"<script>", "select source_id, status from (select source_id, status, row_number() over (partition by source_id "
        + "order by case when status in ('DRAFT','PENDING','APPLYING','FAILED') then 0 else 1 end, created_at desc, request_id desc) as rn "
        + "from byai.digital_employee_publication where tenant_id = #{tenantId} and source_id in",
        "<foreach collection='sourceIds' item='id' open='(' separator=',' close=')'>#{id}</foreach>",
        ") ranked where rn = 1", "</script>"})
    List<DigitalEmployeePublication> currentStatuses(@Param("sourceIds") List<Long> sourceIds, @Param("tenantId") Long tenantId);

    @Select("select * from byai.ss_resource where resource_code = #{code} and com_acct_id = #{tenantId} and resource_status = 2")
    List<SsResource> resourcesByCode(@Param("code") String code, @Param("tenantId") Long tenantId);
}
