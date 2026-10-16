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

    @Select("""
        <script>
        SELECT DISTINCT u.user_id FROM byai.po_users u
        WHERE u.state = 'A'
          AND u.user_id IN
          <foreach collection="userIds" item="id" open="(" separator="," close=")">#{id}</foreach>
        </script>
        """)
    List<Long> activeUsers(@Param("userIds") List<Long> userIds);

    @Select("""
        <script>
        SELECT create_user AS user_id, default_dig_employee_id AS employee_id FROM byai.suas_superassist
        WHERE status = '00' AND create_user IN
          <foreach collection="userIds" item="id" open="(" separator="," close=")">#{id}</foreach>
        </script>
        """)
    List<UserDefaultRow> defaultEmployeesBatch(@Param("userIds") List<Long> userIds);

    record UserDefaultRow(Long userId, Long employeeId) { }

    @Select("""
        SELECT default_dig_employee_id FROM byai.suas_superassist
        WHERE create_user = #{userId} AND status = '00' FOR UPDATE
        """)
    List<Long> defaultEmployeesForUpdate(@Param("userId") Long userId);

    /** Read by creator, never by superassist primary key; duplicate defaults are intentionally rejected. */
    @Select("""
        SELECT default_dig_employee_id FROM byai.suas_superassist
        WHERE create_user = #{userId} AND status = '00'
        """)
    List<Long> defaultEmployees(@Param("userId") Long userId);
}
