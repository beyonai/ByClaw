package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtAgentService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDocService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtMcpService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtObjectService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtSkillService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtToolKitService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtViewService;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtAgent;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDoc;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtMcp;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtObject;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtSkill;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtToolKit;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtView;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtAgentMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtDocMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtMcpMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtObjectMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtSkillMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtToolKitMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtViewMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Arrays;
import java.util.Collection;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Answers.CALLS_REAL_METHODS;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * PR-3 (#150) 批量 findByIds 重构的单测与集成测试.
 * <p>
 * 覆盖三件事:
 * <ol>
 *     <li>7 个 ext mapper 的 {@code findByIds(Collection<Long>)} 边界
 *         (空集合、null、入参重复) — 单元测试.</li>
 *     <li>7 个 ext service 的 {@code findByIds} 包装方法 — 单元测试
 *         (mock mapper, 验证 service.findByIds → mapper.findByIds 一次).</li>
 *     <li>{@link DigitalEmployeeApplicationService#batchLoadTargetContent}
 *         集成场景 — mock 7 个 ext service 各返回 3 条记录, 验证每个 service 的
 *         {@code findByIds} 被调用 1 次 (而非 3 次循环 findById).</li>
 * </ol>
 */
class DigitalEmployeeBatchFindByIdsTest {

    private SsResExtToolKitMapper toolKitMapper;
    private SsResExtMcpMapper mcpMapper;
    private SsResExtAgentMapper agentMapper;
    private SsResExtDocMapper docMapper;
    private SsResExtViewMapper viewMapper;
    private SsResExtObjectMapper objectMapper;
    private SsResExtSkillMapper skillMapper;

    private SsResExtToolKitService toolKitService;
    private SsResExtMcpService mcpService;
    private SsResExtAgentService agentService;
    private SsResExtDocService docService;
    private SsResExtViewService viewService;
    private SsResExtObjectService objectService;
    private SsResExtSkillService skillService;

    private DigitalEmployeeApplicationService appService;

    @BeforeEach
    void setUp() {
        // 使用 CALLS_REAL_METHODS 让 default 方法真实执行 (selectBatchIds 调用路径可验证),
        // 同时 stubbed 方法返回我们指定的 List.
        toolKitMapper = mock(SsResExtToolKitMapper.class, CALLS_REAL_METHODS);
        mcpMapper = mock(SsResExtMcpMapper.class, CALLS_REAL_METHODS);
        agentMapper = mock(SsResExtAgentMapper.class, CALLS_REAL_METHODS);
        docMapper = mock(SsResExtDocMapper.class, CALLS_REAL_METHODS);
        viewMapper = mock(SsResExtViewMapper.class, CALLS_REAL_METHODS);
        objectMapper = mock(SsResExtObjectMapper.class, CALLS_REAL_METHODS);
        skillMapper = mock(SsResExtSkillMapper.class, CALLS_REAL_METHODS);

        toolKitService = new SsResExtToolKitService();
        ReflectionTestUtils.setField(toolKitService, "ssResExtToolKitMapper", toolKitMapper);

        mcpService = new SsResExtMcpService();
        ReflectionTestUtils.setField(mcpService, "ssResExtMcpMapper", mcpMapper);

        agentService = new SsResExtAgentService();
        ReflectionTestUtils.setField(agentService, "ssResExtAgentMapper", agentMapper);

        docService = new SsResExtDocService();
        ReflectionTestUtils.setField(docService, "ssResExtDocMapper", docMapper);

        viewService = new SsResExtViewService();
        ReflectionTestUtils.setField(viewService, "ssResExtViewMapper", viewMapper);

        objectService = new SsResExtObjectService();
        ReflectionTestUtils.setField(objectService, "ssResExtObjectMapper", objectMapper);

        skillService = new SsResExtSkillService();
        ReflectionTestUtils.setField(skillService, "ssResExtSkillMapper", skillMapper);

        appService = new DigitalEmployeeApplicationService();
        ReflectionTestUtils.setField(appService, "ssResExtToolKitService", toolKitService);
        ReflectionTestUtils.setField(appService, "ssResExtMcpService", mcpService);
        ReflectionTestUtils.setField(appService, "ssResExtAgentService", agentService);
        ReflectionTestUtils.setField(appService, "ssResExtDocService", docService);
        ReflectionTestUtils.setField(appService, "ssResExtViewService", viewService);
        ReflectionTestUtils.setField(appService, "ssResExtObjectService", objectService);
        ReflectionTestUtils.setField(appService, "ssResExtSkillService", skillService);
    }

    // ---------------------- 1) Mapper 边界测试 ----------------------

    @Test
    @DisplayName("ToolKitMapper.findByIds: 空集合 → 不触发 SQL，返回空 List")
    void toolkitMapper_findByIds_emptyCollection_returnsEmptyAndSkipsSql() {
        List<SsResExtToolKit> result = toolKitMapper.findByIds(Collections.emptyList());

        assertThat(result).isEmpty();
        verify(toolKitMapper, never()).selectBatchIds(anyCollection());
    }

    @Test
    @DisplayName("McpMapper.findByIds: null → 不触发 SQL，返回空 List")
    void mcpMapper_findByIds_null_returnsEmptyAndSkipsSql() {
        List<SsResExtMcp> result = mcpMapper.findByIds(null);

        assertThat(result).isEmpty();
        verify(mcpMapper, never()).selectBatchIds(anyCollection());
    }

    @Test
    @DisplayName("AgentMapper.findByIds: 去重 → 委托 selectBatchIds")
    void agentMapper_findByIds_dedupDelegatedToSelectBatchIds() {
        Set<Long> dedup = new LinkedHashSet<>(Arrays.asList(1L, 2L, 1L, 3L, 2L));
        SsResExtAgent a1 = new SsResExtAgent();
        a1.setResourceId(1L);
        SsResExtAgent a2 = new SsResExtAgent();
        a2.setResourceId(2L);
        SsResExtAgent a3 = new SsResExtAgent();
        a3.setResourceId(3L);
        when(agentMapper.selectBatchIds(dedup)).thenReturn(Arrays.asList(a1, a2, a3));

        List<SsResExtAgent> result = agentMapper.findByIds(dedup);

        assertThat(result).hasSize(3);
        verify(agentMapper, times(1)).selectBatchIds(dedup);
    }

    @Test
    @DisplayName("DocMapper.findByIds: 非空入参 → 委托 selectBatchIds")
    void docMapper_findByIds_nonEmptyDelegatedToSelectBatchIds() {
        List<Long> ids = Arrays.asList(10L, 20L);
        SsResExtDoc d = new SsResExtDoc();
        d.setResourceId(10L);
        when(docMapper.selectBatchIds(ids)).thenReturn(Collections.singletonList(d));

        List<SsResExtDoc> result = docMapper.findByIds(ids);

        assertThat(result).hasSize(1);
        verify(docMapper, times(1)).selectBatchIds(ids);
    }

    @Test
    @DisplayName("ViewMapper.findByIds: 空集合 → 不触发 SQL")
    void viewMapper_findByIds_emptySkipsSql() {
        List<SsResExtView> result = viewMapper.findByIds(Collections.emptySet());

        assertThat(result).isEmpty();
        verify(viewMapper, never()).selectBatchIds(anyCollection());
    }

    @Test
    @DisplayName("ObjectMapper.findByIds: 空集合 → 不触发 SQL")
    void objectMapper_findByIds_emptySkipsSql() {
        List<SsResExtObject> result = objectMapper.findByIds(Collections.emptyList());

        assertThat(result).isEmpty();
        verify(objectMapper, never()).selectBatchIds(anyCollection());
    }

    @Test
    @DisplayName("SkillMapper.findByIds: null → 不触发 SQL")
    void skillMapper_findByIds_nullSkipsSql() {
        List<SsResExtSkill> result = skillMapper.findByIds(null);

        assertThat(result).isEmpty();
        verify(skillMapper, never()).selectBatchIds(anyCollection());
    }

    // ---------------------- 2) Service 包装方法测试 ----------------------

    @Test
    @DisplayName("ToolKitService.findByIds → Mapper.findByIds 单次调用")
    void toolkitService_findByIds_delegatesToMapperOnce() {
        List<Long> ids = Arrays.asList(1L, 2L, 3L);
        doReturn(Collections.emptyList()).when(toolKitMapper).findByIds(ids);

        List<SsResExtToolKit> result = toolKitService.findByIds(ids);

        assertThat(result).isEmpty();
        verify(toolKitMapper, times(1)).findByIds(ids);
    }

    @Test
    @DisplayName("McpService.findByIds → Mapper.findByIds 单次调用（空集合）")
    void mcpService_findByIds_emptyCollection_passesThrough() {
        doReturn(Collections.emptyList()).when(mcpMapper).findByIds(Collections.emptyList());

        List<SsResExtMcp> result = mcpService.findByIds(Collections.emptyList());

        assertThat(result).isEmpty();
        verify(mcpMapper, times(1)).findByIds(Collections.emptyList());
    }

    @Test
    @DisplayName("ObjectService.findByIds → Mapper.findByIds 单次调用")
    void objectService_findByIds_delegatesToMapperOnce() {
        List<Long> ids = Arrays.asList(5L, 6L);
        doReturn(Collections.emptyList()).when(objectMapper).findByIds(ids);

        List<SsResExtObject> result = objectService.findByIds(ids);

        assertThat(result).isEmpty();
        verify(objectMapper, times(1)).findByIds(ids);
    }

    @Test
    @DisplayName("SkillService.findByIds → Mapper.findByIds 单次调用")
    void skillService_findByIds_delegatesToMapperOnce() {
        List<Long> ids = Arrays.asList(7L, 8L, 9L, 10L);
        doReturn(Collections.emptyList()).when(skillMapper).findByIds(ids);

        List<SsResExtSkill> result = skillService.findByIds(ids);

        assertThat(result).isEmpty();
        verify(skillMapper, times(1)).findByIds(ids);
    }

    // ---------------------- 3) batchLoadTargetContent 集成测试 ----------------------

    @Test
    @DisplayName("batchLoadTargetContent(TOOLKIT, 3 ids) → ToolKit.findByIds 调用 1 次（而非 3 次循环 findById）")
    void batchLoadTargetContent_toolkit_callsFindByIdsOnceNotFindById() {
        List<Long> ids = Arrays.asList(101L, 102L, 103L);
        SsResExtToolKit e1 = new SsResExtToolKit();
        e1.setResourceId(101L);
        e1.setTargetContent("{\"toolkit\":1}");
        SsResExtToolKit e2 = new SsResExtToolKit();
        e2.setResourceId(102L);
        e2.setTargetContent("{\"toolkit\":2}");
        SsResExtToolKit e3 = new SsResExtToolKit();
        e3.setResourceId(103L);
        // target_content 为空的资源不应进入返回 Map
        doReturn(Arrays.asList(e1, e2, e3)).when(toolKitMapper).findByIds(ids);

        Map<Long, String> result = appService.batchLoadTargetContent("TOOLKIT", ids);

        assertThat(result).hasSize(2).containsEntry(101L, "{\"toolkit\":1}")
            .containsEntry(102L, "{\"toolkit\":2}");
        verify(toolKitMapper, times(1)).findByIds(ids);
        // 关键断言:批量替换循环 findById, 确认未调用单条 selectById
        verify(toolKitMapper, never()).selectById(org.mockito.ArgumentMatchers.anyLong());
    }

    @Test
    @DisplayName("batchLoadTargetContent(KG_DOC, 4 ids) → Doc.findByIds 调用 1 次")
    void batchLoadTargetContent_doc_callsFindByIdsOnceNotFindById() {
        List<Long> ids = Arrays.asList(201L, 202L, 203L, 204L);
        SsResExtDoc d1 = new SsResExtDoc();
        d1.setResourceId(201L);
        d1.setTargetContent("{\"kg\":\"doc1\"}");
        SsResExtDoc d2 = new SsResExtDoc();
        d2.setResourceId(202L);
        d2.setTargetContent("{\"kg\":\"doc2\"}");
        doReturn(Arrays.asList(d1, d2)).when(docMapper).findByIds(ids);

        Map<Long, String> result = appService.batchLoadTargetContent("KG_DOC", ids);

        assertThat(result).hasSize(2);
        verify(docMapper, times(1)).findByIds(ids);
        verify(docMapper, never()).selectById(org.mockito.ArgumentMatchers.anyLong());
    }

    @Test
    @DisplayName("batchLoadTargetContent(空集合) → 早返回 Map.empty，不触发任何 mapper 调用")
    void batchLoadTargetContent_emptyCollection_returnsEmptyImmediately() {
        Map<Long, String> result = appService.batchLoadTargetContent("TOOLKIT", Collections.emptyList());

        assertThat(result).isEmpty();
        verify(toolKitMapper, never()).findByIds(anyCollection());
    }

    @Test
    @DisplayName("batchLoadTargetContent(null) → 早返回 Map.empty")
    void batchLoadTargetContent_nullCollection_returnsEmptyImmediately() {
        Map<Long, String> result = appService.batchLoadTargetContent("MCP", null);

        assertThat(result).isEmpty();
        verify(mcpMapper, never()).findByIds(anyCollection());
    }

    @Test
    @DisplayName("batchLoadTargetContent(去重 null/重复) → 仅入参非空且去重")
    void batchLoadTargetContent_filtersNullAndDuplicates() {
        Collection<Long> input = Arrays.asList(null, 301L, 301L, 302L, null);
        SsResExtAgent a1 = new SsResExtAgent();
        a1.setResourceId(301L);
        a1.setTargetContent("{\"agent\":1}");
        doReturn(Collections.singletonList(a1)).when(agentMapper).findByIds(anyCollection());

        Map<Long, String> result = appService.batchLoadTargetContent("AGENT", input);

        assertThat(result).hasSize(1).containsEntry(301L, "{\"agent\":1}");
        // 验证传给 mapper 的集合已去重（去重后大小为 2）
        org.mockito.ArgumentCaptor<Collection<Long>> captor =
            org.mockito.ArgumentCaptor.forClass(Collection.class);
        verify(agentMapper, times(1)).findByIds(captor.capture());
        assertThat(new HashSet<>(captor.getValue())).hasSize(2);
    }

    @Test
    @DisplayName("batchLoadTargetContent(TOOLKIT, mapper 抛异常) → 整体异常被 catch，返回空 Map 不影响调用方")
    void batchLoadTargetContent_toolkitMapperThrows_returnsEmptyMapAndLogsWarn() {
        List<Long> ids = Arrays.asList(401L, 402L);
        doThrow(new RuntimeException("simulated DB failure")).when(toolKitMapper).findByIds(ids);

        Map<Long, String> result = appService.batchLoadTargetContent("TOOLKIT", ids);

        assertThat(result).isEmpty();
        verify(toolKitMapper, times(1)).findByIds(ids);
    }

    @Test
    @DisplayName("batchLoadTargetContent(VIEW, mapper 返回空) → 返回空 Map")
    void batchLoadTargetContent_viewEmptyResult_returnsEmptyMap() {
        List<Long> ids = Arrays.asList(501L, 502L);
        doReturn(Collections.emptyList()).when(viewMapper).findByIds(ids);

        Map<Long, String> result = appService.batchLoadTargetContent("VIEW", ids);

        assertThat(result).isEmpty();
        verify(viewMapper, times(1)).findByIds(ids);
        verify(viewMapper, never()).selectById(org.mockito.ArgumentMatchers.anyLong());
    }

    @Test
    @DisplayName("batchLoadTargetContent(OBJECT) → Mapper.findByIds 调用 1 次（替换原循环 findById）")
    void batchLoadTargetContent_object_callsFindByIdsOnceNotFindById() {
        List<Long> ids = Arrays.asList(601L, 602L);
        SsResExtObject o = new SsResExtObject();
        o.setResourceId(601L);
        o.setTargetContent("{\"object\":1}");
        doReturn(Collections.singletonList(o)).when(objectMapper).findByIds(ids);

        Map<Long, String> result = appService.batchLoadTargetContent("OBJECT", ids);

        assertThat(result).hasSize(1).containsEntry(601L, "{\"object\":1}");
        verify(objectMapper, times(1)).findByIds(ids);
        verify(objectMapper, never()).selectById(org.mockito.ArgumentMatchers.anyLong());
    }

    @Test
    @DisplayName("batchLoadTargetContent(SKILL) → Mapper.findByIds 调用 1 次（替换原循环 findById）")
    void batchLoadTargetContent_skill_callsFindByIdsOnceNotFindById() {
        List<Long> ids = Arrays.asList(701L, 702L, 703L);
        SsResExtSkill s = new SsResExtSkill();
        s.setResourceId(702L);
        s.setTargetContent("{\"skill\":2}");
        doReturn(Collections.singletonList(s)).when(skillMapper).findByIds(ids);

        Map<Long, String> result = appService.batchLoadTargetContent("SKILL", ids);

        assertThat(result).hasSize(1).containsEntry(702L, "{\"skill\":2}");
        verify(skillMapper, times(1)).findByIds(ids);
        verify(skillMapper, never()).selectById(org.mockito.ArgumentMatchers.anyLong());
    }

    @Test
    @DisplayName("batchLoadTargetContent(MCP) → Mapper.findByIds 调用 1 次（替换原循环 findById）")
    void batchLoadTargetContent_mcp_callsFindByIdsOnceNotFindById() {
        List<Long> ids = Arrays.asList(801L, 802L);
        SsResExtMcp m = new SsResExtMcp();
        m.setResourceId(801L);
        m.setTargetContent("{\"mcp\":1}");
        doReturn(Collections.singletonList(m)).when(mcpMapper).findByIds(ids);

        Map<Long, String> result = appService.batchLoadTargetContent("MCP", ids);

        assertThat(result).hasSize(1).containsEntry(801L, "{\"mcp\":1}");
        verify(mcpMapper, times(1)).findByIds(ids);
        verify(mcpMapper, never()).selectById(org.mockito.ArgumentMatchers.anyLong());
    }
}
