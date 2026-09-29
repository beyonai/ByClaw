package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.slf4j.Logger;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.feign.request.manager.AgentResourceChatInfoDto;
import com.iwhalecloud.byai.common.feign.request.manager.McpServer;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeGroupApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtSkillMapper;
import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;
import com.iwhalecloud.byai.state.domain.agent.service.SsSuperassistSubAgentService;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.resource.bo.AuthContextBo;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceAuthContextService;

/**
 * 卡片 0011：聊天参数解析路径停用四类资源（`ParamService` 双关卡 + 两条补充路径）。
 *
 * <p>断言层级：**直接断言原层**（`ParamService#getParams` 是 public，mock 面可控）——T-08/T-09/T-10 走原层；
 * 其余用例按设计 T-01~T-07/T-11/T-12 断言私有方法（`ReflectionTestUtils.invokeMethod`），
 * 私有方法到 `getParams` 的等价关系由 T-08 覆盖。
 *
 * <p><b>表述边界（设计 I3 红线）</b>：本类只做**参数层断言**——停用类型不进入 `agent_list[].mcpServerList`
 * 与 `resource_list`（有/无占位符两种输入）。**未**断言、也**不得**表述为"已实测远程请求次数为 0"或
 * "已阻断远程调用"：worker 侧对 `agent_list[].mcpServerList` 的消费行为**未核实**。
 *
 * <p>既有 `ParamServiceTest` 原样保留，本类不改写其断言。
 */
class ParamServiceDisabledResourceTest {

    private static final String REASON = "RESOURCE_TYPE_DISABLED";

    private ParamService service;
    private SsResourceService ssResourceService;
    private ResourceAuthContextService resourceAuthContextService;
    private DigitalEmployeeGroupApplicationService digitalEmployeeGroupApplicationService;
    private SsSuperassistSubAgentService ssSuperassistSubAgentService;
    private Logger logger;

    @BeforeEach
    void setUp() {
        service = new ParamService();
        ssResourceService = mock(SsResourceService.class);
        resourceAuthContextService = mock(ResourceAuthContextService.class);
        digitalEmployeeGroupApplicationService = mock(DigitalEmployeeGroupApplicationService.class);
        ssSuperassistSubAgentService = mock(SsSuperassistSubAgentService.class);
        SsResExtSkillMapper ssResExtSkillMapper = mock(SsResExtSkillMapper.class);
        when(ssResExtSkillMapper.selectBatchIds(any())).thenReturn(new ArrayList<>());
        logger = mock(Logger.class);
        ReflectionTestUtils.setField(service, "ssResourceService", ssResourceService);
        ReflectionTestUtils.setField(service, "resourceAuthContextService", resourceAuthContextService);
        ReflectionTestUtils.setField(service, "digitalEmployeeGroupApplicationService",
            digitalEmployeeGroupApplicationService);
        ReflectionTestUtils.setField(service, "ssSuperassistSubAgentService", ssSuperassistSubAgentService);
        ReflectionTestUtils.setField(service, "ssResExtSkillMapper", ssResExtSkillMapper);
        ReflectionTestUtils.setField(service, "logger", logger);
    }

    // ------------------------------------------------------------------ T-01

    @Test
    void getAllMcpIds_excludesAllFourDisabledTypes() {
        for (String disabledType : List.of("OBJECT", "VIEW", "ONTOLOGY_BASE", "SCENE")) {
            Map<String, List<Long>> selectedSkills = new LinkedHashMap<>();
            selectedSkills.put(disabledType, List.of(999L));

            List<Long> mcpIds = getAllMcpIds(selectedSkills);

            assertThat(mcpIds).as("input=%s", selectedSkills).isEmpty();
        }
    }

    // ------------------------------------------------------------------ T-02

    @Test
    void getAllMcpIds_normalizesCaseAndWhitespaceVariants() {
        for (String variant : List.of("object", "Object", " OBJECT ", "view", "ontology_base", "Scene")) {
            // 断言 A（停用侧）：变体键不贡献 id。
            Map<String, List<Long>> disabledOnly = new LinkedHashMap<>();
            disabledOnly.put(variant, List.of(999L));
            assertThat(getAllMcpIds(disabledOnly)).as("variant=%s", variant).isEmpty();

            // 断言 B（正常侧，成对，缺一不可）：同一请求中的 MCP 条目必须存活，不得因变体整表清空。
            Map<String, List<Long>> mixed = new LinkedHashMap<>();
            mixed.put(variant, List.of(999L));
            mixed.put("MCP", List.of(888L));
            assertThat(getAllMcpIds(mixed)).as("variant=%s", variant).containsExactly(888L);
        }
    }

    // ------------------------------------------------------------------ T-03

    @Test
    void getAllMcpIds_keepsMcpAndIgnoresOtherTypes() {
        Map<String, List<Long>> selectedSkills = new LinkedHashMap<>();
        selectedSkills.put("MCP", List.of(888L));
        selectedSkills.put("OBJECT", List.of(999L));
        selectedSkills.put("TOOLKIT", List.of(777L));
        assertThat(getAllMcpIds(selectedSkills)).containsExactly(888L);

        // 与基线一致：非 MCP 的正常类型键不贡献 MCP 白名单。
        assertThat(getAllMcpIds(Map.of("TOOLKIT", List.of(777L)))).isEmpty();
        assertThat(getAllMcpIds(Map.of("KG_DOC", List.of(555L)))).isEmpty();
    }

    // ------------------------------------------------------------------ T-04

    @Test
    void filterMcpServerList_removesDisabledEntriesKeepsNormal() {
        // 规范大写：OBJECT 条目被移除，MCP 条目保留。
        AgentResourceChatInfoDto agentInfo = agentWithMcpServers(999L, "OBJECT", 888L, "MCP");
        invokeFilterSelectedSkills(agentInfo, Map.of("OBJECT", List.of(999L), "MCP", List.of(888L)));
        assertThat(mcpIds(agentInfo)).containsExactly(888L);

        // 变体混合：不得整表清空（基线在此处会清空全部条目 —— Q-2 登记的行为变更）。
        AgentResourceChatInfoDto variantAgent = agentWithMcpServers(999L, "OBJECT", 888L, "MCP");
        Map<String, List<Long>> variantSkills = new LinkedHashMap<>();
        variantSkills.put("object", List.of(999L));
        variantSkills.put("MCP", List.of(888L));
        invokeFilterSelectedSkills(variantAgent, variantSkills);
        assertThat(mcpIds(variantAgent)).containsExactly(888L);
    }

    // ------------------------------------------------------------------ T-05

    @Test
    void getAllMcpIds_honoursLowercaseMcpKeyAsDocumentedChange() {
        // Q-2 登记的行为变更：基线（精确匹配 "MCP"）对小写键返回空 ⇒ 整表被清空；
        // 改造后归一化识别为 MCP ⇒ 按 id 保留。此处显式固定该变化。
        assertThat(getAllMcpIds(Map.of("mcp", List.of(888L)))).containsExactly(888L);
        assertThat(getAllMcpIds(Map.of(" Mcp ", List.of(888L)))).containsExactly(888L);
    }

    // ------------------------------------------------------------------ T-06

    @Test
    void removeDisabledResourceVo_keepsDigEmployeeAndSkillAndDropsDisabled() {
        // 可达性说明：resource_list 的元素类型是 AgentMetaEnum，其中四类停用类型只存在 VIEW / OBJECT
        // （该枚举没有 ONTOLOGY_BASE / SCENE，客户端无法用名字反序列化出它们）。
        // 判定代码仍对四类统一生效（DisabledResourceBizTypes），此处按该通道的**可达集合**构造夹具。
        List<ResourceVo> resourceList = new ArrayList<>(Arrays.asList(
            resourceVo("100", AgentMetaEnum.DIG_EMPLOYEE),
            resourceVo("200", AgentMetaEnum.SKILL),
            resourceVo("999", AgentMetaEnum.VIEW),
            resourceVo("998", AgentMetaEnum.OBJECT)
        ));

        List<ResourceVo> kept = removeDisabledResourceVo(resourceList);

        assertThat(kept).extracting(ResourceVo::getResourceId).containsExactly("100", "200");
        assertThat(disabledResourceIds(resourceList)).containsExactly("999", "998");

        // 变体与空类型不得误伤。
        List<ResourceVo> mixed = new ArrayList<>(Arrays.asList(
            resourceVo("100", AgentMetaEnum.DIG_EMPLOYEE),
            resourceVo("999", AgentMetaEnum.OBJECT),
            resourceVo("998", null)
        ));
        assertThat(removeDisabledResourceVo(mixed)).extracting(ResourceVo::getResourceId)
            .containsExactly("100", "998");
    }

    // ------------------------------------------------------------------ T-07

    @Test
    void pruneDisabledMcpServers_removesDisabledEntriesWithoutAnyPlaceholder() {
        List<AgentResourceChatInfoDto> chatAgentResourceInfo = new ArrayList<>();
        chatAgentResourceInfo.add(agentWithMcpServers(999L, "OBJECT", 888L, "MCP", 997L, "view"));

        invokePruneDisabledMcpServers(chatAgentResourceInfo);

        assertThat(mcpIds(chatAgentResourceInfo.get(0))).containsExactly(888L);

        ArgumentCaptor<Object> arg1 = ArgumentCaptor.forClass(Object.class);
        ArgumentCaptor<Object> arg2 = ArgumentCaptor.forClass(Object.class);
        ArgumentCaptor<Object> arg3 = ArgumentCaptor.forClass(Object.class);
        verify(logger).warn(anyString(), arg1.capture(), arg2.capture(), arg3.capture());
        assertThat(String.valueOf(arg2.getValue())).contains("999").contains("997");
        assertThat(String.valueOf(arg3.getValue())).isEqualTo(REASON);
    }

    // ------------------------------------------------------------------ T-08

    @Test
    void getParams_endToEnd_noDisabledResourceInSessionParams() {
        AgentResourceChatInfoDto agentInfo = agentWithMcpServers(999L, "OBJECT", 888L, "MCP");
        agentInfo.setId(100L);
        agentInfo.setType("DIG_EMPLOYEE");
        when(digitalEmployeeGroupApplicationService.isGroup(100L)).thenReturn(false);
        when(ssSuperassistSubAgentService.getResourceAgent(0, 100L)).thenReturn(agentInfo);
        // 授权面：999 与 888 都已授权 ⇒ 鉴权过滤不会移除它们，停用判定必须由本卡的层② 承担。
        when(resourceAuthContextService.getAuthContextBo())
            .thenReturn(new AuthContextBo(Set.of(999L, 888L), new HashMap<>()));

        AssistantChatDto dto = new AssistantChatDto();
        dto.setAgentId(100L);
        // 混合占位符：停用类型被排除的同时，同一请求中的正常 MCP 条目必须存活（成对断言）。
        dto.setChatContent("{{DIG_EMPLOYEE_100#OBJECT_999}}{{DIG_EMPLOYEE_100#MCP_888}}");
        dto.setIsDebug(0);
        dto.setResourceList(new ArrayList<>(Arrays.asList(
            resourceVo("999", AgentMetaEnum.VIEW),
            resourceVo("100", AgentMetaEnum.DIG_EMPLOYEE)
        )));
        ChatProcessContext ctx = new ChatProcessContext(OutputStream.nullOutputStream(), dto);

        Map<String, Object> params = service.getParams(ctx);

        // 断言 1：会话参数 agent_list 中不含停用类型的 MCP 端点。
        @SuppressWarnings("unchecked")
        List<AgentResourceChatInfoDto> agentList = (List<AgentResourceChatInfoDto>) params.get("agent_list");
        assertThat(agentList).hasSize(1);
        assertThat(mcpIds(agentList.get(0))).doesNotContain(999L).containsExactly(888L);

        // 断言 2：会话参数 resource_list 中不含停用类型条目（且 DTO 已同步收口）。
        @SuppressWarnings("unchecked")
        List<ResourceVo> resourceList = (List<ResourceVo>) params.get("resource_list");
        assertThat(resourceList).extracting(ResourceVo::getResourceId).containsExactly("100");
        assertThat(dto.getResourceList()).extracting(ResourceVo::getResourceId).containsExactly("100");

        // 说明：ParamService 不持有 RouteService 依赖（路由在 ScriptService 内完成），
        // 故本层无法也不需要断言"未调用 routeService"；此处断言的是 getParams 的返回值本身不含停用条目。
    }

    // ------------------------------------------------------------------ T-09

    @Test
    void getParams_normalTypesUnchanged() {
        AgentResourceChatInfoDto agentInfo = agentWithMcpServers(888L, "MCP");
        agentInfo.setId(100L);
        agentInfo.setType("DIG_EMPLOYEE");
        when(digitalEmployeeGroupApplicationService.isGroup(100L)).thenReturn(false);
        when(ssSuperassistSubAgentService.getResourceAgent(0, 100L)).thenReturn(agentInfo);
        when(resourceAuthContextService.getAuthContextBo())
            .thenReturn(new AuthContextBo(Set.of(888L), new HashMap<>()));

        AssistantChatDto dto = new AssistantChatDto();
        dto.setAgentId(100L);
        dto.setChatContent("{{DIG_EMPLOYEE_100#MCP_888}}{{DIG_EMPLOYEE_100#KG_DOC_555}}");
        dto.setIsDebug(0);
        dto.setResourceList(new ArrayList<>(Arrays.asList(
            resourceVo("100", AgentMetaEnum.DIG_EMPLOYEE),
            resourceVo("200", AgentMetaEnum.SKILL)
        )));
        ChatProcessContext ctx = new ChatProcessContext(OutputStream.nullOutputStream(), dto);

        Map<String, Object> params = service.getParams(ctx);

        @SuppressWarnings("unchecked")
        List<AgentResourceChatInfoDto> agentList = (List<AgentResourceChatInfoDto>) params.get("agent_list");
        assertThat(mcpIds(agentList.get(0))).containsExactly(888L);

        @SuppressWarnings("unchecked")
        List<ResourceVo> resourceList = (List<ResourceVo>) params.get("resource_list");
        assertThat(resourceList).extracting(ResourceVo::getResourceId).containsExactly("100", "200");
    }

    // ------------------------------------------------------------------ T-10

    @Test
    void getParams_forgedTypesAndLegacyIdsCannotBypass() {
        AgentResourceChatInfoDto agentInfo = agentWithMcpServers(999L, "OBJECT", 888L, "MCP");
        agentInfo.setId(100L);
        agentInfo.setType("DIG_EMPLOYEE");
        when(digitalEmployeeGroupApplicationService.isGroup(100L)).thenReturn(false);
        when(ssSuperassistSubAgentService.getResourceAgent(0, 100L)).thenReturn(agentInfo);
        when(resourceAuthContextService.getAuthContextBo())
            .thenReturn(new AuthContextBo(Set.of(999L, 888L), new HashMap<>()));

        AssistantChatDto dto = new AssistantChatDto();
        dto.setAgentId(100L);
        // 伪造类型 + 未知类型 + 空类型：不得借此保留停用 id，也不得抛出新异常。
        dto.setChatContent("{{DIG_EMPLOYEE_100#OBJECTX_999}}{{DIG_EMPLOYEE_100#FOO_999}}"
            + "{{DIG_EMPLOYEE_100#_999}}{{DIG_EMPLOYEE_100#MCP_888}}");
        dto.setIsDebug(0);
        dto.setResourceList(new ArrayList<>(Collections.singletonList(resourceVo("999", AgentMetaEnum.OBJECT))));
        ChatProcessContext ctx = new ChatProcessContext(OutputStream.nullOutputStream(), dto);

        Map<String, Object> params = service.getParams(ctx);

        // 旧 OBJECT id 已存在于 mcpServerList 中并被显式点名 ⇒ 仍被排除（层② 不依赖占位符解析结果）。
        @SuppressWarnings("unchecked")
        List<AgentResourceChatInfoDto> agentList = (List<AgentResourceChatInfoDto>) params.get("agent_list");
        assertThat(mcpIds(agentList.get(0))).containsExactly(888L);

        // resource_list 中的 OBJECT 条目被剔除 ⇒ 键不存在（基线会放入）。
        assertThat(params).doesNotContainKey("resource_list");
    }

    // ------------------------------------------------------------------ T-11

    @Test
    void getAllMcpIds_nullAndEmptyInputsAreSafe() {
        assertThat(getAllMcpIds(new HashMap<>())).isEmpty();
        assertThat(getAllMcpIds(new LinkedHashMap<>(Map.of("MCP", new ArrayList<>())))).isEmpty();

        Map<String, List<Long>> withNullValue = new LinkedHashMap<>();
        withNullValue.put("MCP", null);
        withNullValue.put("OBJECT", null);
        assertThat(getAllMcpIds(withNullValue)).isEmpty();

        // null 键：归一化后为空串 ⇒ 跳过，不抛异常。
        Map<String, List<Long>> withNullKey = new LinkedHashMap<>();
        withNullKey.put(null, List.of(999L));
        withNullKey.put("MCP", List.of(888L));
        assertThat(getAllMcpIds(withNullKey)).containsExactly(888L);
    }

    // ------------------------------------------------------------------ T-12

    @Test
    void filterSelectedSkills_gate1RemovesDisabledKeysBeforeDispatch() {
        // Gate 1 直接断言：剔除停用键、保留正常键；无停用键时原样返回入参（快路径）。
        Map<String, List<Long>> selectedSkills = new LinkedHashMap<>();
        selectedSkills.put("OBJECT", List.of(999L));
        selectedSkills.put("MCP", List.of(888L));
        Map<String, List<Long>> effective = invokeEnabledSkillsOnly(selectedSkills);
        assertThat(effective).containsOnlyKeys("MCP");

        Map<String, List<Long>> normalOnly = new LinkedHashMap<>();
        normalOnly.put("MCP", List.of(888L));
        assertThat(invokeEnabledSkillsOnly(normalOnly)).isSameAs(normalOnly);

        // 可观察效果：Gate 1 之后分发链未把整表清空（888 存活），且 999 被 Gate 2 排除。
        AgentResourceChatInfoDto agentInfo = agentWithMcpServers(999L, "OBJECT", 888L, "MCP");
        invokeFilterSelectedSkills(agentInfo, selectedSkills);
        assertThat(mcpIds(agentInfo)).containsExactly(888L);

        // 全停用输入：保持基线"整表清空"语义，不新增误伤。
        AgentResourceChatInfoDto disabledOnlyAgent = agentWithMcpServers(999L, "OBJECT");
        invokeFilterSelectedSkills(disabledOnlyAgent, Map.of("OBJECT", List.of(999L)));
        assertThat(disabledOnlyAgent.getMcpServerList()).isNull();
    }

    // ------------------------------------------------------------- 基础设施

    private List<Long> getAllMcpIds(Map<String, List<Long>> selectedSkills) {
        return ReflectionTestUtils.invokeMethod(service, "getAllMcpIds", selectedSkills);
    }

    @SuppressWarnings("unchecked")
    private Map<String, List<Long>> invokeEnabledSkillsOnly(Map<String, List<Long>> selectedSkills) {
        return ReflectionTestUtils.invokeMethod(service, "enabledSkillsOnly", selectedSkills);
    }

    private void invokeFilterSelectedSkills(AgentResourceChatInfoDto agentInfo,
        Map<String, List<Long>> selectedSkills) {
        ReflectionTestUtils.invokeMethod(service, "filterSelectedSkills", agentInfo, selectedSkills);
    }

    private void invokePruneDisabledMcpServers(List<AgentResourceChatInfoDto> chatAgentResourceInfo) {
        ReflectionTestUtils.invokeMethod(service, "pruneDisabledMcpServers", chatAgentResourceInfo);
    }

    @SuppressWarnings("unchecked")
    private List<ResourceVo> removeDisabledResourceVo(List<ResourceVo> resourceList) {
        return ReflectionTestUtils.invokeMethod(service, "removeDisabledResourceVo", resourceList);
    }

    @SuppressWarnings("unchecked")
    private List<String> disabledResourceIds(List<ResourceVo> resourceList) {
        return ReflectionTestUtils.invokeMethod(service, "disabledResourceIds", resourceList);
    }

    private static List<Long> mcpIds(AgentResourceChatInfoDto agentInfo) {
        if (agentInfo == null || agentInfo.getMcpServerList() == null) {
            return Collections.emptyList();
        }
        return agentInfo.getMcpServerList().stream().map(McpServer::getMcpResourceId).toList();
    }

    /** 构造 mcpServerList 夹具，入参为 (id, bizType) 交替。 */
    private static AgentResourceChatInfoDto agentWithMcpServers(Object... idAndBizTypePairs) {
        AgentResourceChatInfoDto agentInfo = new AgentResourceChatInfoDto();
        List<McpServer> servers = new ArrayList<>();
        for (int i = 0; i < idAndBizTypePairs.length; i += 2) {
            McpServer server = new McpServer();
            server.setMcpResourceId((Long) idAndBizTypePairs[i]);
            server.setMcpResourceBizType((String) idAndBizTypePairs[i + 1]);
            servers.add(server);
        }
        agentInfo.setMcpServerList(servers);
        return agentInfo;
    }

    private static ResourceVo resourceVo(String resourceId, AgentMetaEnum resourceType) {
        ResourceVo vo = new ResourceVo();
        vo.setResourceId(resourceId);
        vo.setResourceType(resourceType);
        return vo;
    }
}
