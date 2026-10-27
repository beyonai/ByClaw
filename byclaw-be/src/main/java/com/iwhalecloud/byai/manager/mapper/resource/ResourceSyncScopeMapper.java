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

    /** Resolve the stable personal assistant code independently of the user's selected default employee. */
    @Select("""
        <script>
        SELECT u.user_id AS user_id, r.resource_id AS employee_id
        FROM byai.po_users u
        JOIN byai.ss_resource r ON r.resource_code = CONCAT(u.user_code, '_personal')
        WHERE u.user_code IS NOT NULL AND u.user_code &lt;&gt; ''
          AND r.resource_biz_type = 'DIG_EMPLOYEE' AND r.resource_status &lt;&gt; -1
          AND u.user_id IN
          <foreach collection="userIds" item="id" open="(" separator="," close=")">#{id}</foreach>
        </script>
        """)
    List<UserAssistantRow> personalAssistantsBatch(@Param("userIds") List<Long> userIds);

    record UserAssistantRow(Long userId, Long employeeId) { }

    /** Recheck the code mapping after the caller has locked the candidate employee resource. */
    @Select("""
        SELECT r.resource_id FROM byai.po_users u
        JOIN byai.ss_resource r ON r.resource_code = CONCAT(u.user_code, '_personal')
        WHERE u.user_id = #{userId} AND u.user_code IS NOT NULL AND u.user_code <> ''
          AND r.resource_biz_type = 'DIG_EMPLOYEE' AND r.resource_status <> -1
        """)
    List<Long> personalAssistants(@Param("userId") Long userId);
}
