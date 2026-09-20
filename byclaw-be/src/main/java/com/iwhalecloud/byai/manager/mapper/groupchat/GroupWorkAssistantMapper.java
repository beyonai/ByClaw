package com.iwhalecloud.byai.manager.mapper.groupchat;

import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/** 按名称定位平台统一发布的群组工作助手。 */
@Mapper
public interface GroupWorkAssistantMapper {
    @Select("""
        SELECT r.resource_id
        FROM byai.ss_resource r
        JOIN byai.ss_res_ext_dig_employee e ON e.resource_id = r.resource_id
        WHERE r.owner_type = 'enterprise'
          AND r.resource_biz_type = 'DIG_EMPLOYEE'
          AND r.resource_status = 2
          AND r.resource_name = #{name}
          AND e.agent_type <> '017'
        ORDER BY r.resource_id
        LIMIT 2
        """)
    List<Long> findCandidates(@Param("name") String name);
}
