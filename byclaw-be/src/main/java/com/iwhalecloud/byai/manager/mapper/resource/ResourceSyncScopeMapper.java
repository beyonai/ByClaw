package com.iwhalecloud.byai.manager.mapper.resource;

import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface ResourceSyncScopeMapper {
    @Select("SELECT count(*) FROM byai.po_users WHERE user_id = #{id} AND state = 'A'")
    int activeUser(Long id);

    @Select("SELECT count(*) FROM byai.po_organization WHERE org_id = #{id}")
    int organization(Long id);

    @Select("SELECT count(*) FROM byai.po_position WHERE position_id = #{id} AND is_digital_position = 0")
    int ordinaryPost(Long id);

    @Select("SELECT count(*) FROM byai.tenant_user_membership WHERE user_id = #{userId} AND enterprise_id = #{tenantId} AND status = 'ACTIVE'")
    int tenantMember(@Param("userId") Long userId, @Param("tenantId") Long tenantId);

    @Select("""
        WITH RECURSIVE tenant_orgs AS (
            SELECT org_id FROM byai.tenant_organization WHERE enterprise_id = #{tenantId}
            UNION
            SELECT child.org_id FROM byai.po_organization child
            JOIN tenant_orgs parent ON child.parent_org_id = parent.org_id
        ) SELECT count(*) FROM tenant_orgs WHERE org_id = #{orgId}
        """)
    int tenantOrganization(@Param("orgId") Long orgId, @Param("tenantId") Long tenantId);

    @Select("""
        <script>
        SELECT DISTINCT u.user_id FROM byai.po_users u
        JOIN byai.tenant_user_membership m ON m.user_id = u.user_id
        WHERE u.state = 'A' AND m.status = 'ACTIVE' AND m.enterprise_id = #{tenantId}
          AND u.user_id IN
          <foreach collection="userIds" item="id" open="(" separator="," close=")">#{id}</foreach>
        </script>
        """)
    List<Long> activeTenantUsers(@Param("userIds") List<Long> userIds, @Param("tenantId") Long tenantId);

    @Select("""
        <script>
        SELECT create_user AS user_id, default_dig_employee_id AS employee_id FROM byai.suas_superassist
        WHERE com_acct_id = #{tenantId} AND status = '00' AND create_user IN
          <foreach collection="userIds" item="id" open="(" separator="," close=")">#{id}</foreach>
        </script>
        """)
    List<UserDefaultRow> defaultEmployeesBatch(@Param("userIds") List<Long> userIds, @Param("tenantId") Long tenantId);

    record UserDefaultRow(Long userId, Long employeeId) { }

    @Select("""
        SELECT default_dig_employee_id FROM byai.suas_superassist
        WHERE create_user = #{userId} AND com_acct_id = #{tenantId} AND status = '00' FOR UPDATE
        """)
    List<Long> defaultEmployeesForUpdate(@Param("userId") Long userId, @Param("tenantId") Long tenantId);

    /** Read by creator, never by superassist primary key; duplicate defaults are intentionally rejected. */
    @Select("""
        SELECT default_dig_employee_id FROM byai.suas_superassist
        WHERE create_user = #{userId} AND com_acct_id = #{tenantId} AND status = '00'
        """)
    List<Long> defaultEmployees(@Param("userId") Long userId, @Param("tenantId") Long tenantId);
}
