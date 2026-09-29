package com.iwhalecloud.byai.manager.mapper.tenant;

import java.util.List;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface TenantMembershipMapper {

    @Select("""
        SELECT CAST(m.enterprise_id AS VARCHAR) AS "enterpriseId",
               e.com_acct_name AS "enterpriseName",
               m.role AS "role",
               c.params_value AS "provisionStateJson"
        FROM byai.tenant_user_membership m
        JOIN byai.po_enterprise_info e ON e.enterprise_id = m.enterprise_id
        LEFT JOIN byai.tenant_config c ON c.enterprise_id = m.enterprise_id
                                 AND c.params_code = 'PROVISION_STATE'
        WHERE m.user_id = #{userId}
          AND m.status = 'ACTIVE'
        ORDER BY e.com_acct_name, m.enterprise_id
        """)
    List<TenantMembershipRow> selectAvailableForUser(@Param("userId") Long userId);

    @Select("""
        SELECT CAST(m.enterprise_id AS VARCHAR) AS "enterpriseId",
               e.com_acct_name AS "enterpriseName",
               m.role AS "role",
               c.params_value AS "provisionStateJson"
        FROM byai.tenant_user_membership m
        JOIN byai.po_enterprise_info e ON e.enterprise_id = m.enterprise_id
        LEFT JOIN byai.tenant_config c ON c.enterprise_id = m.enterprise_id
                                 AND c.params_code = 'PROVISION_STATE'
        WHERE m.user_id = #{userId}
          AND m.enterprise_id = #{enterpriseId}
          AND m.status = 'ACTIVE'
        LIMIT 1
        """)
    TenantMembershipRow selectActiveMembership(@Param("userId") Long userId,
                                               @Param("enterpriseId") Long enterpriseId);
}
