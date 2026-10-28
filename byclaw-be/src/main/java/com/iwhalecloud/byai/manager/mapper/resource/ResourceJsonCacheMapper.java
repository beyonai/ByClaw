package com.iwhalecloud.byai.manager.mapper.resource;

import java.util.List;
import lombok.Data;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/** Keyset pages of persisted standard JSON for both synchronized and locally configured resources. */
@Mapper
public interface ResourceJsonCacheMapper {
    @Select("""
        SELECT r.resource_id, r.resource_biz_type, r.resource_status,
          CASE r.resource_biz_type
            WHEN 'SKILL' THEN s.target_content WHEN 'TOOL' THEN t.target_content
            WHEN 'TOOLKIT' THEN k.target_content WHEN 'MCP' THEN m.target_content
            WHEN 'AGENT' THEN a.target_content
            WHEN 'OBJECT' THEN o.target_content WHEN 'VIEW' THEN v.target_content
            ELSE d.target_content END AS target_content
        FROM byai.ss_resource r
        LEFT JOIN ss_res_ext_skill s ON s.resource_id = r.resource_id AND r.resource_biz_type = 'SKILL'
        LEFT JOIN ss_res_ext_tool t ON t.resource_id = r.resource_id AND r.resource_biz_type = 'TOOL'
        LEFT JOIN ss_res_ext_toolkit k ON k.resource_id = r.resource_id AND r.resource_biz_type = 'TOOLKIT'
        LEFT JOIN ss_res_ext_mcp m ON m.resource_id = r.resource_id AND r.resource_biz_type = 'MCP'
        LEFT JOIN ss_res_ext_agent a ON a.resource_id = r.resource_id AND r.resource_biz_type = 'AGENT'
        LEFT JOIN ss_res_ext_object o ON o.resource_id = r.resource_id AND r.resource_biz_type = 'OBJECT'
        LEFT JOIN ss_res_ext_view v ON v.resource_id = r.resource_id AND r.resource_biz_type = 'VIEW'
        LEFT JOIN ss_res_ext_doc d ON d.resource_id = r.resource_id AND r.resource_biz_type LIKE 'KG_%'
        WHERE r.resource_id > #{afterId}
          AND r.resource_biz_type IN ('SKILL','TOOL','TOOLKIT','MCP','AGENT',
            'OBJECT','VIEW','KG_DOC','KG_QA','KG_TERM','KG_DB')
        ORDER BY r.resource_id LIMIT #{limit}
        """)
    List<Entry> page(@Param("afterId") long afterId, @Param("limit") int limit);

    @Data
    class Entry {
        private long resourceId;
        private String resourceBizType;
        private Integer resourceStatus;
        private String targetContent;
    }
}
