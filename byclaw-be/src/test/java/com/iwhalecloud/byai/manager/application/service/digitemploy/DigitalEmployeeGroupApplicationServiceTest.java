package com.iwhalecloud.byai.manager.application.service.digitemploy;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.when;

import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.iwhalecloud.byai.common.feign.response.knowledge.ModelDto;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AiModelService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.dto.digitemploy.EmployeeGroupMemberDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDetailsDTO;
import com.iwhalecloud.byai.manager.dto.orchestrator.OrchestratorRuntimeDTO;
import com.iwhalecloud.byai.manager.dto.orchestrator.OrchestratorRuntimeRequestDTO;
import com.iwhalecloud.byai.manager.dto.resource.ResourceExtDigEmployeeDto;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceVersion;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceVersionMapper;
import com.iwhalecloud.byai.manager.vo.resource.DigitalEmployeePageVo;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

@ExtendWith(MockitoExtension.class)
class DigitalEmployeeGroupApplicationServiceTest {

    @Mock
    private SequenceService sequenceService;
    @Mock
    private SsResourceService ssResourceService;
    @Mock
    private SsResExtDigEmployeeService ssResExtDigEmployeeService;
    @Mock
    private SsResourceRelDetailService ssResourceRelDetailService;
    @Mock
    private SsResourceVersionMapper ssResourceVersionMapper;
    @Mock
    private AuthApplicationService authApplicationService;
    @Mock
    private AiModelService aiModelService;

    @InjectMocks
    private DigitalEmployeeGroupApplicationService service;

    @BeforeEach
    void setUpUser() {
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(88L);
        loginInfo.setUserCode("user88");
        loginInfo.setEnterpriseId(1L);
        CurrentUserHolder.setLoginInfo(loginInfo);
    }

    @AfterEach
    void clearUser() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void resolveRuntime_returnsSanitizedPublishedSnapshot() {
        SsResource group = groupResource();
        SsResExtDigEmployee groupExt = new SsResExtDigEmployee();
        groupExt.setAgentType("017");
        SsResourceVersion version = new SsResourceVersion();
        version.setResourceVersionId(21L);
        version.setVersionStatus(3);
        version.setExtInfo("{\"schemaVersion\":\"byclaw.digital-employee-group-runtime/v1\","
            + "\"prompt\":\"你是营销组团长\",\"modelId\":\"10023\","
            + "\"members\":[{\"resourceId\":20001,\"teamRole\":\"调研分析\",\"sortOrder\":1}]}");
        ResourceExtDigEmployeeDto member = memberResource();
        ModelDto model = new ModelDto();
        model.setInstanceId("10023");

        when(ssResourceService.findById(90001L)).thenReturn(group);
        when(ssResExtDigEmployeeService.findById(90001L)).thenReturn(groupExt);
        when(authApplicationService.hasResourceUsePermission(group)).thenReturn(true);
        when(ssResourceVersionMapper.selectById(21L)).thenReturn(version);
        when(aiModelService.getModel("10023")).thenReturn(model);
        when(ssResExtDigEmployeeService.findExtDigEmployeeByIds(anyCollection())).thenReturn(List.of(member));

        OrchestratorRuntimeDTO result = service.resolveRuntime(request());

        assertThat(result.getSchemaVersion()).isEqualTo("byclaw.orchestrator-runtime/v1");
        assertThat(result.getOrchestrator().getId()).isEqualTo("90001");
        assertThat(result.getPrompt().getVersion()).isEqualTo("21");
        assertThat(result.getModel().getModelId()).isEqualTo("10023");
        assertThat(result.getAgents()).singleElement().satisfies(agent -> {
            assertThat(agent.getId()).isEqualTo("20001");
            assertThat(agent.getTeamRole()).isEqualTo("调研分析");
            assertThat(agent.getAgentType()).isEqualTo("001");
        });
    }

    @Test
    void resolveRuntime_rejectsUserWithoutGroupUsePermission() {
        SsResource group = groupResource();
        SsResExtDigEmployee groupExt = new SsResExtDigEmployee();
        groupExt.setAgentType("017");
        when(ssResourceService.findById(90001L)).thenReturn(group);
        when(ssResExtDigEmployeeService.findById(90001L)).thenReturn(groupExt);
        when(authApplicationService.hasResourceUsePermission(group)).thenReturn(false);

        assertThatThrownBy(() -> service.resolveRuntime(request()))
            .isInstanceOf(ResponseStatusException.class)
            .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
                .isEqualTo(HttpStatus.FORBIDDEN));
    }

    @Test
    void resolveRuntime_hidesGroupFromAnotherEnterprise() {
        SsResource group = groupResource();
        group.setComAcctId(2L);
        SsResExtDigEmployee groupExt = new SsResExtDigEmployee();
        groupExt.setAgentType("017");
        when(ssResourceService.findById(90001L)).thenReturn(group);
        when(ssResExtDigEmployeeService.findById(90001L)).thenReturn(groupExt);

        assertThatThrownBy(() -> service.resolveRuntime(request()))
            .isInstanceOf(ResponseStatusException.class)
            .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
                .isEqualTo(HttpStatus.NOT_FOUND));
    }

    @Test
    void resolveRuntime_rejectsGroupWithoutPublishedConfiguration() {
        SsResource group = groupResource();
        group.setResourceRVerid(null);
        SsResExtDigEmployee groupExt = new SsResExtDigEmployee();
        groupExt.setAgentType("017");
        when(ssResourceService.findById(90001L)).thenReturn(group);
        when(ssResExtDigEmployeeService.findById(90001L)).thenReturn(groupExt);
        when(authApplicationService.hasResourceUsePermission(group)).thenReturn(true);

        assertThatThrownBy(() -> service.resolveRuntime(request()))
            .isInstanceOf(ResponseStatusException.class)
            .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
                .isEqualTo(HttpStatus.CONFLICT));
    }

    @Test
    void filterMemberCandidates_returnsManageablePublishedEmployees() {
        DigitalEmployeePageVo row = new DigitalEmployeePageVo();
        row.setResourceId(20001L);
        PageInfo<DigitalEmployeePageVo> source = new PageInfo<>();
        source.setPageNum(1);
        source.setPageSize(20);
        source.setList(List.of(row));
        ResourceExtDigEmployeeDto member = memberResource();

        when(ssResExtDigEmployeeService.findExtDigEmployeeByIds(anyCollection())).thenReturn(List.of(member));
        when(authApplicationService.hasResourceManagePermission(member)).thenReturn(true);

        PageInfo<EmployeeGroupMemberDTO> result = service.filterMemberCandidates(source);

        assertThat(result.getList()).singleElement().satisfies(candidate -> {
            assertThat(candidate.getResourceId()).isEqualTo(20001L);
            assertThat(candidate.getName()).isEqualTo("市场调研专家");
            assertThat(candidate.getWorkerAgentType()).isEqualTo("BYCLAW_EXE");
        });
    }

    @Test
    void enrichGroupDetails_returnsSavedMemberTeamRoles() {
        DigitalEmployeeDetailsDTO details = new DigitalEmployeeDetailsDTO();
        details.setResourceId(90001L);
        details.setAgentType("017");
        details.setResourceRVerid(21L);
        SsResourceRelDetail relation = new SsResourceRelDetail();
        relation.setResourceId(90001L);
        relation.setRelResourceId(20001L);
        relation.setRelResourceInfo("{\"schemaVersion\":\"byclaw.digital-employee-group-member/v1\","
            + "\"teamRole\":\"调研分析\",\"sortOrder\":2}");

        when(ssResourceRelDetailService.list(org.mockito.ArgumentMatchers.<Wrapper<SsResourceRelDetail>>any()))
            .thenReturn(List.of(relation));
        when(ssResExtDigEmployeeService.findExtDigEmployeeByIds(anyCollection())).thenReturn(List.of(memberResource()));

        service.enrichGroupDetails(details);

        assertThat(details.getEmployeeGroupMembers()).singleElement().satisfies(member -> {
            assertThat(member.getTeamRole()).isEqualTo("调研分析");
            assertThat(member.getSortOrder()).isEqualTo(2);
        });
        assertThat(details.getConfigVersion()).isEqualTo("21");
    }

    private OrchestratorRuntimeRequestDTO request() {
        OrchestratorRuntimeRequestDTO request = new OrchestratorRuntimeRequestDTO();
        request.setSchemaVersion("byclaw.orchestrator-runtime-request/v1");
        request.setKind("EXPERT_TEAM");
        request.setOrchestratorId("90001");
        return request;
    }

    private SsResource groupResource() {
        SsResource group = new SsResource();
        group.setResourceId(90001L);
        group.setResourceName("营销数字员工组");
        group.setResourceBizType("DIG_EMPLOYEE");
        group.setResourceStatus(2);
        group.setComAcctId(1L);
        group.setResourceRVerid(21L);
        return group;
    }

    private ResourceExtDigEmployeeDto memberResource() {
        ResourceExtDigEmployeeDto member = new ResourceExtDigEmployeeDto();
        member.setResourceId(20001L);
        member.setResourceCode("market_research");
        member.setResourceName("市场调研专家");
        member.setResourceDesc("负责市场与竞品调研");
        member.setResourceBizType("DIG_EMPLOYEE");
        member.setResourceStatus(2);
        member.setComAcctId(1L);
        member.setWorkerAgentType("BYCLAW_EXE");
        SsResExtDigEmployee ext = new SsResExtDigEmployee();
        ext.setAgentType("001");
        ext.setCreateType("SELF");
        member.setSsResExtDigEmployee(ext);
        return member;
    }
}
