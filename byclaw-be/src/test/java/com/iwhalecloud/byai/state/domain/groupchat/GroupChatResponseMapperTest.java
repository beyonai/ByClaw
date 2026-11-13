package com.iwhalecloud.byai.state.domain.groupchat;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.Test;

/** 避免空字符串按 NULL 处理的数据库丢失候选响应；创建者 Codex，2026-11-13。 */
class GroupChatResponseMapperTest {
    private String query(String cursor, List<String> ids) throws Exception {
        var configuration = new Configuration();
        String resource = "com/iwhalecloud/byai/manager/mapper/groupchat/ByaiGroupChatResponseMapper.xml";
        try (var input = getClass().getClassLoader().getResourceAsStream(resource)) {
            new XMLMapperBuilder(input, configuration, resource, configuration.getSqlFragments()).parse();
        }
        Map<String, Object> parameters = new HashMap<>();
        parameters.put("groupId", 10L);
        parameters.put("cursor", cursor);
        parameters.put("ids", ids);
        parameters.put("limit", 50);
        return configuration.getMappedStatement(
            "com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatResponseMapper.selectResponses")
            .getBoundSql(parameters).getSql().replaceAll("\\s+", " ");
    }

    @Test
    void firstPageDoesNotCompareAgainstAnEmptyCursor() throws Exception {
        assertFalse(query(null, null).contains("e.response_id >"));
        assertFalse(query("", null).contains("e.response_id >"));
        assertTrue(query("turn:20", null).contains("e.response_id >"));
    }

    @Test
    void bothDiscoveryAndBindingKeepExecutionsWithoutTasks() throws Exception {
        for (String sql : List.of(query(null, null), query("", List.of("turn:20")))) {
            assertTrue(sql.contains("t.status IS NULL OR t.status <> 'PRIVATE'"));
            assertFalse(sql.contains("COALESCE(t.status,''"));
        }
    }
}
