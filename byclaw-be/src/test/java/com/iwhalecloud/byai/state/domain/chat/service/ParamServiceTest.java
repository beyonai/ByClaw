package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.common.constants.resource.WorkerAgentType;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeGroupApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceAuthContextService;
import java.io.ByteArrayOutputStream;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.util.ReflectionTestUtils;

class ParamServiceTest extends com.iwhalecloud.byai.common.i18n.I18nTestSupport {

    private ParamService service;
    private SsResourceService ssResourceService;

    @BeforeEach
    void setUp() {
        service = new ParamService();
        ssResourceService = mock(SsResourceService.class);
        ReflectionTestUtils.setField(service, "ssResourceService", ssResourceService);
    }

    @Test
    void resolveWorkerAgentType_routesNullAgentIdToBySuper() {
        assertThat(service.resolveWorkerAgentType(null)).isEqualTo(WorkerAgentType.BY_SUPER.getCode());
        verifyNoInteractions(ssResourceService);
    }

    @Test
    void resolveWorkerAgentType_usesConfiguredResourceWorker() {
        SsResource resource = new SsResource();
        resource.setWorkerAgentType(WorkerAgentType.BYCLAW_QA.getCode());
        when(ssResourceService.findById(100L)).thenReturn(resource);

        assertThat(service.resolveWorkerAgentType(100L)).isEqualTo(WorkerAgentType.BYCLAW_QA.getCode());
        verify(ssResourceService).findById(100L);
    }

    @Test
    void resolveWorkerAgentType_keepsLegacyFallbackForUnknownNonNullAgentId() {
        when(ssResourceService.findById(404L)).thenReturn(null);

        assertThat(service.resolveWorkerAgentType(404L)).isEqualTo(WorkerAgentType.BYCLAW_EXE.getCode());
        verify(ssResourceService).findById(404L);
    }

    @ParameterizedTest
    @ValueSource(strings = {"HARNESS", "BY_SUPER"})
    void getParams_preservesExpertTeamWorkerAndOrchestration(String workerAgentType) {
        var groups = mock(DigitalEmployeeGroupApplicationService.class);
        ReflectionTestUtils.setField(service, "digitalEmployeeGroupApplicationService", groups);
        ReflectionTestUtils.setField(service, "resourceAuthContextService", mock(ResourceAuthContextService.class));
        SsResource group = new SsResource();
        group.setResourceId(100L);
        group.setWorkerAgentType(workerAgentType);
        when(ssResourceService.findById(100L)).thenReturn(group);
        when(groups.isGroup(100L)).thenReturn(true);
        AssistantChatDto dto = new AssistantChatDto();
        dto.setAgentId(100L);
        ChatProcessContext ctx = new ChatProcessContext(new ByteArrayOutputStream(), dto);

        Map<String, Object> params = service.getParams(ctx);

        assertThat(params).containsEntry("worker_agent_type", workerAgentType)
            .containsEntry("orchestrator", Map.of("schemaVersion", "byclaw.orchestrator-ref/v1",
                "kind", "EXPERT_TEAM", "id", "100"));
    }

    @Test
    void passiveExistingInputCannotReachSkillExpansionButActiveChoicesKeepSameId() {
        var groups = mock(DigitalEmployeeGroupApplicationService.class);
        ReflectionTestUtils.setField(service, "digitalEmployeeGroupApplicationService", groups);
        ReflectionTestUtils.setField(service, "resourceAuthContextService", mock(ResourceAuthContextService.class));
        var extensions = mock(com.iwhalecloud.byai.manager.mapper.resource.SsResExtSkillMapper.class);
        ReflectionTestUtils.setField(service, "ssResExtSkillMapper", extensions);
        SsResource group = new SsResource(); group.setResourceId(100L); group.setWorkerAgentType("HARNESS");
        when(ssResourceService.findById(100L)).thenReturn(group); when(groups.isGroup(100L)).thenReturn(true);
        var skill = new com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo(); skill.setId("SKILL_123"); skill.setResourceId("123");
        skill.setResourceType(com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum.SKILL); skill.setResourceName("需求说明"); skill.setResourceCode("active-skill");
        AssistantChatDto dto = new AssistantChatDto(); dto.setAgentId(100L); dto.setChatContent("{{SKILL_123}}"); dto.setResourceList(java.util.List.of(skill));
        var ctx = new ChatProcessContext(new ByteArrayOutputStream(), dto);
        var existing = new com.iwhalecloud.byai.state.domain.message.dto.ByaiMessageHotDtoDto();
        existing.setMessageContent("{{SKILL_123}}"); existing.setMetadata("{\"kind\":\"FORWARD_SINGLE\",\"resourceList\":[{\"id\":\"SKILL_123\",\"resourceName\":\"需求说明\",\"resourceType\":\"SKILL\",\"resourceId\":\"123\"}]}");
        ctx.existingUserMessage = existing;
        assertThat(service.getParams(ctx)).doesNotContainKey("resource_list");
        assertThat(dto.getResourceList()).isEmpty(); assertThat(dto.getChatContent()).isEqualTo("需求说明");
        verifyNoInteractions(extensions);
        existing.setMetadata("{\"scene\":\"GROUP_TASK\"}"); dto.setResourceList(java.util.List.of(skill));
        assertThat(service.getParams(ctx).get("resource_list")).isEqualTo(java.util.List.of(skill));
    }


    @Test
    void activeSkillStillReceivesExtensionDataAfterPassiveInputWasExcluded() {
        var authService = mock(ResourceAuthContextService.class);
        when(authService.getAuthContextBo()).thenReturn(new com.iwhalecloud.byai.state.domain.resource.bo.AuthContextBo(java.util.Set.of(), Map.of()));
        ReflectionTestUtils.setField(service, "resourceAuthContextService", authService);
        ReflectionTestUtils.setField(service, "digitalEmployeeGroupApplicationService", mock(DigitalEmployeeGroupApplicationService.class));
        var agents = mock(com.iwhalecloud.byai.state.domain.agent.service.SsSuperassistSubAgentService.class);
        var agent = new com.iwhalecloud.byai.common.feign.request.manager.AgentResourceChatInfoDto(); agent.setId(100L);
        when(agents.getResourceAgent(org.mockito.ArgumentMatchers.nullable(Integer.class), org.mockito.ArgumentMatchers.eq(100L))).thenReturn(agent); ReflectionTestUtils.setField(service, "ssSuperassistSubAgentService", agents);
        var extensions = mock(com.iwhalecloud.byai.manager.mapper.resource.SsResExtSkillMapper.class);
        ReflectionTestUtils.setField(service, "ssResExtSkillMapper", extensions);
        var ext = new com.iwhalecloud.byai.manager.entity.resource.SsResExtSkill(); ext.setResourceId(123L); ext.setSkillType("inner"); ext.setSkillUrl("/active/skill");
        when(extensions.selectBatchIds(java.util.List.of(123L))).thenReturn(java.util.List.of(ext));
        var skill = new com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo(); skill.setResourceId("123");
        skill.setResourceType(com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum.SKILL); skill.setResourceName("主动技能"); skill.setResourceCode("active-skill");
        var dto = new AssistantChatDto(); dto.setAgentId(100L); dto.setChatContent("按主动选择处理"); dto.setResourceList(java.util.List.of(skill));
        var ctx = new ChatProcessContext(new ByteArrayOutputStream(), dto);
        var existing = new com.iwhalecloud.byai.state.domain.message.dto.ByaiMessageHotDtoDto(); existing.setMetadata("{\"kind\":\"FORWARD_SINGLE\"}"); ctx.existingUserMessage = existing;
        assertThat(service.getParams(ctx)).doesNotContainKey("resource_list");
        verifyNoInteractions(extensions);
        existing.setMetadata("{\"scene\":\"GROUP_TASK\",\"quote\":{\"forward\":{\"resourceMode\":\"SNAPSHOT_ONLY\"}}}");
        dto.setResourceList(java.util.List.of(skill));
        var params = service.getParams(ctx);
        assertThat(params.get("resource_list")).isEqualTo(java.util.List.of(skill));
        assertThat(skill.getExtData()).contains("/active/skill");
    }


    @Test
    void externalAgentHistoryDoesNotRestoreSnapshotDownloadLinks() {
        var history = mock(com.iwhalecloud.byai.common.message.service.ByaiMessageHotService.class);
        ReflectionTestUtils.setField(service, "byaiMessageHotService", history);
        var message = new com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto(); message.setUsage(1); message.setMessageContent("{{opaque}} /literal/body");
        message.setMetadata("{\"kind\":\"FORWARD_SINGLE\",\"resourceList\":[{\"id\":\"opaque\",\"resourceName\":\"需求说明\",\"resourceType\":\"COMMON_FILE\",\"resourceId\":\"/private\"}]}");
        message.setRelatedResources("{\"files\":[{\"fileName\":\"需求\",\"fileUrl\":\"/private/download\"}]}");
        when(history.findByQo(org.mockito.ArgumentMatchers.any())).thenReturn(java.util.List.of(message));
        assertThat(service.getChatHistories(60L, 10)).isEqualTo(java.util.List.of(Map.of("role", "user", "content", "需求说明 /literal/body")));
    }

}
