package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.application.service.digitemploy.event.DigEmployeeChangeEventPublisher;
import com.iwhalecloud.byai.manager.domain.resource.service.*;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.dto.digitemploy.*;
import com.iwhalecloud.byai.manager.entity.resource.*;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.resource.*;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import org.springframework.transaction.support.TransactionTemplate;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class EmployeePublicationApplicationServiceTest {
    DigitalEmployeePublicationMapper publications = mock(DigitalEmployeePublicationMapper.class);
    SsResourceMapper resources = mock(SsResourceMapper.class);
    UserService users = mock(UserService.class);
    ByaiSystemConfigService config = mock(ByaiSystemConfigService.class);
    DigitalEmployeeGovernanceService governance = new DigitalEmployeeGovernanceService(users, config, publications);
    DigitalEmployeeApplicationService employees = mock(DigitalEmployeeApplicationService.class);
    EmployeePublicationResources dependencies = mock(EmployeePublicationResources.class);
    SsResExtDigEmployeeService extensions = mock(SsResExtDigEmployeeService.class);
    SsResourceRelDetailService relations = mock(SsResourceRelDetailService.class);
    AuthApplicationService auth = mock(AuthApplicationService.class);
    SequenceService sequence = mock(SequenceService.class);
    PlatformTransactionManager transactions = mock(PlatformTransactionManager.class);
    EmployeePublicationApplicationService service;
    SsResource source;
    DigitalEmployeePublication publication;

    @BeforeEach void setup() {
        com.baomidou.mybatisplus.core.metadata.TableInfoHelper.initTableInfo(
            new org.apache.ibatis.builder.MapperBuilderAssistant(new com.baomidou.mybatisplus.core.MybatisConfiguration(), "publication-test"),
            DigitalEmployeePublication.class);
        login("user", 7L, List.of());
        when(config.getDcSystemConfigValueByCode("BYAI_BRAND_VERSION")).thenReturn("openSource");
        when(transactions.getTransaction(any())).thenAnswer(invocation -> new SimpleTransactionStatus());
        when(sequence.nextVal()).thenReturn(101L, 102L, 103L);
        service = new EmployeePublicationApplicationService(publications, resources, governance, employees, dependencies,
            extensions, relations, mock(ResourceRuntimeInfoResolver.class), auth, sequence,
            new TransactionTemplate(transactions), mock(DigEmployeeChangeEventPublisher.class));
        source = employee(10L, 7L);
        when(resources.selectById(10L)).thenReturn(source);
        when(publications.lockResource(10L, 1L)).thenReturn(source);
        when(publications.creatorName(7L)).thenReturn("作者");
        when(dependencies.capture(any(), anyLong(), anyLong(), anyLong())).thenReturn(List.of());
        when(dependencies.materialize(anyList(), eq(1L), anyLong())).thenReturn(Map.of());
        when(dependencies.audienceRoots(1L)).thenReturn(List.of(1L));
        DigitalEmployeeDetailsDTO details = new DigitalEmployeeDetailsDTO();
        details.setAgentType("001"); details.setResourceName("员工"); details.setOwnerType("personal");
        details.setResourceId(10L); details.setRelIds(List.of());
        when(employees.findDetailsById(any())).thenReturn(details);
        publication = new DigitalEmployeePublication();
        publication.setRequestId(100L); publication.setRevision(1L); publication.setTenantId(1L);
        publication.setAuthorId(7L); publication.setAuthorName("作者"); publication.setSourceId(10L);
        publication.setStatus("DRAFT"); publication.setSnapshotJson(JSON.toJSONString(details)); publication.setDependenciesJson("[]");
        when(publications.selectById(100L)).thenReturn(publication);
        when(publications.lock(100L, 1L)).thenReturn(publication);
        when(publications.current(10L, 1L)).thenReturn(publication);
    }
    @AfterEach void cleanup() { CurrentUserHolder.clearLoginInfo(); }
    static void login(String code, Long id, List<String> roles) {
        LoginInfo info = new LoginInfo(); info.setUserCode(code); info.setUserId(id); info.setUserName(code);
        info.setEnterpriseId(1L); info.setUsersOrganizations(roles.stream().map(role -> {
            var org = new com.iwhalecloud.byai.common.login.bean.UsersOrganization(); org.setUserType(role); org.setOrgId(1L); org.setPathCode("1"); return org;
        }).toList()); CurrentUserHolder.setLoginInfo(info);
    }
    static SsResource employee(Long id, Long creator) {
        SsResource resource = new SsResource(); resource.setResourceId(id); resource.setCreateBy(creator);
        resource.setComAcctId(1L); resource.setOwnerType("personal"); resource.setResourceStatus(2);
        resource.setResourceBizType("DIG_EMPLOYEE"); resource.setResourceCode("employee-" + id); return resource;
    }
    EmployeePublicationRequest request() {
        EmployeePublicationRequest request = new EmployeePublicationRequest(); request.setRequestId(100L);
        request.setRevision(publication.getRevision()); return request;
    }

    @Test void ordinarySubmissionOnlyQueuesReview() {
        var result = service.submit(request());
        assertThat(result.publication().getStatus()).isEqualTo("PENDING");
        verify(resources, never()).insert(any(SsResource.class));
        verify(employees, never()).syncPublicationOpenClawWorkSpace(anyLong(), any());
    }

    @Test void previewChecksResourcesWithoutSavingOrSubmittingCandidate() {
        String storedDependencies = publication.getDependenciesJson();
        doAnswer(invocation -> {
            List<EmployeePublicationResources.Dependency> deps = invocation.getArgument(0);
            var dependency = new EmployeePublicationResources.Dependency();
            dependency.setLabel("受限知识库"); dependency.setResourceType("KG_DOC");
            dependency.setWarning("未向全员授权"); dependency.setAvailabilityScope("原有授权用户");
            dependency.setImpact("未获授权的其他人无法使用"); dependency.setAction("REFERENCE_RESOURCE");
            deps.add(dependency);
            return null;
        }).when(dependencies).validate(anyList(), eq(7L), eq(1L));
        var preview = service.preview(request());
        assertThat(preview.publication().getStatus()).isEqualTo("DRAFT");
        assertThat(preview.publication().getRevision()).isEqualTo(1L);
        assertThat(preview.dependencies().getFirst().resourceType()).isEqualTo("KG_DOC");
        assertThat(preview.dependencies().getFirst().availabilityScope()).isEqualTo("原有授权用户");
        assertThat(preview.dependencies().getFirst().reason()).isEqualTo("未向全员授权");
        assertThat(preview.dependencies().getFirst().impact()).contains("其他人无法使用");
        assertThat(publication.getDependenciesJson()).isEqualTo(storedDependencies);
        verify(publications, never()).update(isNull(), any());
        verify(publications, never()).insert(any(DigitalEmployeePublication.class));
        verify(dependencies, never()).materialize(anyList(), anyLong(), anyLong());
        verifyNoInteractions(extensions);
    }

    @Test void staleOrUnauthorizedPreviewCannotBeConfirmed() {
        EmployeePublicationRequest stale = request(); stale.setRevision(0L);
        assertThatThrownBy(() -> service.preview(stale)).hasMessageContaining("申请已被修改");
        publication.setStatus("PENDING");
        assertThatThrownBy(() -> service.preview(request())).hasMessageContaining("仅 adminvip");
        login("admin", 8L, List.of("PLAT_MAN"));
        assertThat(service.preview(request()).canReview()).isTrue();
        publication.setStatus("PUBLISHED");
        assertThatThrownBy(() -> service.preview(request())).hasMessageContaining("当前申请状态");
    }
    @ParameterizedTest @ValueSource(longs = {1L, 37L})
    void adminSubmissionPublishesNewCopyInTheSourceTenantAndDoesNotMutateSource(long tenantId) {
        login("admin", 7L, List.of("PLAT_MAN"));
        CurrentUserHolder.getLoginInfo().setEnterpriseId(tenantId);
        source.setComAcctId(tenantId);
        publication.setTenantId(tenantId);
        when(publications.lock(100L, tenantId)).thenReturn(publication);
        when(publications.lockResource(10L, tenantId)).thenReturn(source);
        when(dependencies.audienceRoots(tenantId)).thenReturn(List.of(1L));
        when(dependencies.materialize(anyList(), eq(tenantId), anyLong())).thenReturn(Map.of());
        when(employees.syncPublicationOpenClawWorkSpace(anyLong(), any())).thenReturn(true);
        var result = service.submit(request());
        assertThat(result.publication().getStatus()).isEqualTo("PUBLISHED");
        verify(resources).insert(argThat((SsResource copy) -> copy.getResourceId() != 10L && copy.getCreateBy() == 7L
            && copy.getPublicationSourceId() == 10L && "enterprise".equals(copy.getOwnerType())
            && copy.getComAcctId().equals(source.getComAcctId())));
        assertThat(source.getOwnerType()).isEqualTo("personal");
        verify(dependencies).grantAudience(any(), eq(tenantId));
    }
    @ParameterizedTest @ValueSource(booleans = {false, true})
    void changedOrMissingSourceTenantCannotCreateOfficialCopyOrGrantAccess(boolean missing) {
        login("admin", 8L, List.of("PLAT_MAN")); publication.setStatus("PENDING");
        SsResource moved = employee(10L, 7L); moved.setComAcctId(2L);
        when(publications.lockResource(10L, 1L)).thenReturn(missing ? null : moved);
        var result = service.approve(request());
        assertThat(result.publication().getStatus()).isEqualTo("FAILED");
        assertThat(result.publication().getPublishError()).contains(missing ? "数字员工不存在" : "企业归属不一致");
        verify(resources, never()).insert(any(SsResource.class));
        verify(dependencies, never()).materialize(anyList(), anyLong(), anyLong());
        verify(dependencies, never()).grantAudience(any(), anyLong());
    }
    @Test void officialCopyCannotBeUpdatedAfterItsTenantChanges() {
        login("admin", 8L, List.of("PLAT_MAN")); publication.setStatus("PENDING");
        SsResource official = employee(90L, 7L);
        official.setOwnerType("enterprise"); official.setPublicationSourceId(10L);
        when(publications.official(10L, 1L)).thenReturn(official);
        SsResource moved = employee(90L, 7L); moved.setComAcctId(2L);
        when(publications.lockResource(90L, 1L)).thenReturn(moved);
        var result = service.approve(request());
        assertThat(result.publication().getStatus()).isEqualTo("FAILED");
        assertThat(result.publication().getPublishError()).contains("官方副本与原员工的企业归属不一致");
        verify(resources, never()).updateById(any(SsResource.class));
        verify(resources, never()).insert(any(SsResource.class));
        verify(dependencies, never()).grantAudience(any(), anyLong());
    }
    @ParameterizedTest @ValueSource(strings = {"ORG_MAN", "BUSINESS_MAN", "PLAT_DEVOPS"})
    void otherAdminRolesCannotApprove(String role) {
        login("admin", 7L, List.of(role)); publication.setStatus("PENDING");
        assertThatThrownBy(() -> service.approve(request())).isInstanceOf(BaseException.class);
        verify(resources, never()).insert(any(SsResource.class));
    }
    @Test void ordinaryAuthorCannotEditPendingCandidate() {
        publication.setStatus("PENDING");
        assertThatThrownBy(() -> service.save(request())).hasMessageContaining("审核期间不可编辑");
    }
    @Test void staleRevisionCannotApproveOrChangeStatus() {
        login("admin", 8L, List.of("PLAT_MAN")); publication.setStatus("PENDING");
        EmployeePublicationRequest stale = request(); stale.setRevision(0L);
        assertThatThrownBy(() -> service.approve(stale)).hasMessageContaining("申请已被修改");
        assertThat(publication.getStatus()).isEqualTo("PENDING");
        verify(resources, never()).insert(any(SsResource.class));
    }
    @Test void existingOfficialIsUpdatedInPlaceWithOriginalAttribution() {
        login("admin", 8L, List.of("PLAT_MAN")); publication.setStatus("PENDING");
        SsResource official = employee(90L, 7L); official.setOwnerType("enterprise"); official.setPublicationSourceId(10L);
        publication.setOfficialId(90L);
        when(resources.selectById(90L)).thenReturn(official);
        when(publications.lockResource(90L, 1L)).thenReturn(official);
        when(publications.official(10L, 1L)).thenReturn(official);
        when(employees.syncPublicationOpenClawWorkSpace(eq(90L), any())).thenReturn(true);
        var result = service.approve(request());
        assertThat(result.publication().getOfficialId()).isEqualTo(90L);
        verify(resources, never()).insert(any(SsResource.class));
        verify(resources).updateById(argThat((SsResource copy) -> copy.getCreateBy() == 7L && copy.getUpdateBy() == 8L));
        verify(dependencies, never()).grantAudience(any(), anyLong());
    }
    @Test void duplicateApprovalDoesNotCreateAnotherCopy() {
        login("admin", 8L, List.of("PLAT_MAN")); publication.setStatus("PUBLISHED");
        assertThat(service.approve(request()).publication().getStatus()).isEqualTo("PUBLISHED");
        verify(resources, never()).insert(any(SsResource.class));
        verify(dependencies, never()).materialize(anyList(), anyLong(), anyLong());
    }
    @Test void failedRuntimeRollsBackAndRestoresCommittedRuntime() {
        login("admin", 8L, List.of("PLAT_MAN")); publication.setStatus("PENDING");
        when(employees.syncPublicationOpenClawWorkSpace(anyLong(), any())).thenReturn(false);
        var result = service.approve(request());
        assertThat(result.publication().getStatus()).isEqualTo("FAILED");
        verify(transactions).rollback(any());
        verify(employees).restorePublicationRuntimeAfterRollback(anyLong());
    }
    @Test void failedInitialPublicationCanBeRetriedByAdmin() {
        login("admin", 8L, List.of("PLAT_MAN")); publication.setStatus("FAILED");
        publication.setPublishError("old error");
        when(employees.syncPublicationOpenClawWorkSpace(anyLong(), any())).thenReturn(true);
        var result = service.approve(request());
        assertThat(result.publication().getStatus()).isEqualTo("PUBLISHED");
        assertThat(result.publication().getPublishError()).isNull();
    }
    @Test void candidateChangesDoNotWriteLiveEmployee() {
        EmployeePublicationRequest request = request();
        DigitalEmployeeDTO dto = JSON.parseObject(publication.getSnapshotJson(), DigitalEmployeeDTO.class);
        dto.setResourceName("修改后名称"); request.setEmployee(dto);
        service.save(request);
        assertThat(publication.getEmployeeName()).isEqualTo("修改后名称(企业)");
        verify(resources, never()).updateById(any(SsResource.class));
        verifyNoInteractions(extensions);
    }
    @Test void prepareReturnsExistingActiveRequest() {
        when(publications.active(10L, 1L)).thenReturn(publication);
        assertThat(service.prepare(10L).publication().getRequestId()).isEqualTo(100L);
        verify(publications, never()).insert(any(DigitalEmployeePublication.class));
    }
    @Test void publicationIsAvailableInBothEditionsWithoutChangingRoleRules() {
        for (String edition : new String[]{"commercial", "openSource", null, "", "unknown"}) {
            when(config.getDcSystemConfigValueByCode("BYAI_BRAND_VERSION")).thenReturn(edition);
            assertThat(service.capabilities()).containsEntry("enabled", true).containsEntry("administrator", false);
            assertThat(service.current(10L).publication()).isSameAs(publication);
            assertThat(service.detail(100L).canSubmit()).isTrue();
        }
        login("adminvip", 7L, List.of());
        assertThat(service.capabilities()).containsEntry("enabled", true).containsEntry("administrator", true);
    }
    @Test void tenantMismatchRejectedBeforeReadingSnapshot() {
        publication.setTenantId(2L);
        assertThatThrownBy(() -> service.detail(100L)).hasMessageContaining("无权访问");
    }
    @Test void platformCanPreparePublicationForAnotherCreatorWithoutChangingTheSource() {
        login("platform", 8L, List.of("PLAT_MAN"));
        assertThat(service.prepare(10L).canSubmit()).isTrue();
        verify(resources, never()).updateById(any(SsResource.class));
    }
    @Test void adminvipEmployeeOwnershipDoesNotOverridePlatformReviewerPermission() {
        Users creator = new Users(); creator.setUserCode("adminvip"); when(users.findById(7L)).thenReturn(creator);
        login("platform", 8L, List.of("PLAT_MAN")); publication.setStatus("PENDING");
        when(employees.syncPublicationOpenClawWorkSpace(anyLong(), any())).thenReturn(true);
        assertThat(service.approve(request()).publication().getStatus()).isEqualTo("PUBLISHED");
    }

    @Test void platformSubmissionOfAdminvipEmployeeUsesNormalImmediatePublication() {
        Users creator = new Users(); creator.setUserCode("adminvip"); when(users.findById(7L)).thenReturn(creator);
        login("platform", 8L, List.of("PLAT_MAN"));
        assertThat(service.prepare(10L).canSubmit()).isTrue();
        when(employees.syncPublicationOpenClawWorkSpace(anyLong(), any())).thenReturn(true);
        var result = service.submit(request());
        assertThat(result.publication().getStatus()).isEqualTo("PUBLISHED");
        assertThat(result.publication().isRequiresAdminVipReview()).isFalse();
        assertThat(publication.getReviewerId()).isEqualTo(8L);
        assertThat(publication.getReviewedAt()).isNotNull();
    }

    @ParameterizedTest @ValueSource(longs = {7L, 9L})
    void copiedAdminvipSkillStillRequiresAdminvipRegardlessOfEmployeeCreator(Long skillCreator) {
        Users creator = new Users(); creator.setUserCode("adminvip"); when(users.findById(skillCreator)).thenReturn(creator);
        var skill = employee(20L, skillCreator); skill.setResourceBizType("SKILL");
        var dependency = new EmployeePublicationResources.Dependency();
        dependency.setResource(skill); dependency.setAction("COPY_SKILL"); dependency.setCopyName("技能(企业)");
        publication.setDependenciesJson(JSON.toJSONString(List.of(dependency)));
        login("platform", 7L, List.of("PLAT_MAN"));
        assertThat(service.submit(request()).canReview()).isFalse();
        assertThat(publication.getStatus()).isEqualTo("PENDING");
        try (var messages = mockStatic(com.iwhalecloud.byai.common.i18n.I18nUtil.class)) {
            messages.when(() -> com.iwhalecloud.byai.common.i18n.I18nUtil.get("employee.publication.adminvip.skill.review"))
                .thenReturn("adminvip skill review required");
            messages.when(() -> com.iwhalecloud.byai.common.i18n.I18nUtil.get("adminvip skill review required"))
                .thenReturn("adminvip skill review required");
            assertThatThrownBy(() -> service.approve(request())).hasMessage("adminvip skill review required");
        }
        when(publications.selectList(any())).thenReturn(List.of(publication));
        assertThat(service.pendingCount()).isZero();
        assertThat(service.list(true, 1, 20).list().getFirst().isCanReview()).isFalse();
        login("adminvip", 9L, List.of());
        assertThat(service.detail(100L).canReview()).isTrue();
    }

    @ParameterizedTest @ValueSource(strings = {"OMIT_RESOURCE", "REFERENCE_RESOURCE"})
    void omittedOrExistingEnterpriseAdminvipSkillDoesNotRequireExtraReview(String action) {
        Users creator = new Users(); creator.setUserCode("adminvip"); when(users.findById(9L)).thenReturn(creator);
        var skill = employee(20L, 9L); skill.setResourceBizType("SKILL");
        if ("REFERENCE_RESOURCE".equals(action)) skill.setOwnerType("enterprise");
        var dependency = new EmployeePublicationResources.Dependency();
        dependency.setResource(skill); dependency.setAction(action);
        publication.setDependenciesJson(JSON.toJSONString(List.of(dependency)));
        login("platform", 7L, List.of("PLAT_MAN"));
        when(employees.syncPublicationOpenClawWorkSpace(anyLong(), any())).thenReturn(true);
        assertThat(service.submit(request()).publication().getStatus()).isEqualTo("PUBLISHED");
        assertThat(publication.getReviewerId()).isEqualTo(7L);
    }

    @ParameterizedTest @ValueSource(strings = {"platform", "adminvip"})
    void administratorsPublishPlatformCreatedEmployeeImmediatelyWithReviewRecord(String operator) {
        login(operator, 8L, List.of("PLAT_MAN"));
        when(employees.syncPublicationOpenClawWorkSpace(anyLong(), any())).thenReturn(true);
        assertThat(service.submit(request()).publication().getStatus()).isEqualTo("PUBLISHED");
        assertThat(publication.getReviewerId()).isEqualTo(8L);
        assertThat(publication.getReviewerName()).isEqualTo(operator);
        assertThat(publication.getReviewedAt()).isNotNull();
        assertThat(publication.getComment()).contains("免人工审核");
    }
    @Test void superAssistantAndGroupsAreRejected() {
        DigitalEmployeeDTO dto = JSON.parseObject(publication.getSnapshotJson(), DigitalEmployeeDTO.class);
        source.setResourceCode("user_main");
        assertThatThrownBy(() -> EmployeePublicationApplicationService.sanitize(dto, source)).hasMessageContaining("超级助手");
        source.setResourceCode("employee"); dto.setAgentType("017");
        assertThatThrownBy(() -> EmployeePublicationApplicationService.sanitize(dto, source)).hasMessageContaining("员工组");
    }

    @Test void rejectedCandidateCanBeRevisedWithoutDestroyingAuditHistory() {
        publication.setStatus("REJECTED");
        var next = service.revise(request()).publication();
        assertThat(next.getRequestId()).isNotEqualTo(publication.getRequestId());
        assertThat(next.getStatus()).isEqualTo("DRAFT");
        assertThat(next.getSnapshotJson()).contains("员工");
        assertThat(publication.getStatus()).isEqualTo("REJECTED");
        verify(publications).insert(next);
    }

    @ParameterizedTest @ValueSource(strings = {"DRAFT", "PENDING", "APPLYING", "FAILED", "REJECTED", "WITHDRAWN", "PUBLISHED"})
    void openingCurrentApplicationShowsStoredSnapshotAndNeverCreatesDraft(String state) {
        publication.setStatus(state); publication.setComment("请修改岗位描述");
        assertThat(service.current(10L).publication()).isSameAs(publication);
        assertThat(service.current(10L).employee().getResourceName()).isEqualTo("员工");
        verify(publications, never()).insert(any(DigitalEmployeePublication.class));
        verifyNoInteractions(dependencies);
    }

    @ParameterizedTest @ValueSource(strings = {"REJECTED", "WITHDRAWN", "PUBLISHED"})
    void preparingPersonalEmployeeReusesItsLatestResult(String state) {
        publication.setStatus(state);
        assertThat(service.prepare(10L).publication()).isSameAs(publication);
        verify(publications, never()).insert(any(DigitalEmployeePublication.class));
        verify(employees, never()).findDetailsById(any());
    }

    @Test void noHistoryOnlyCreatesDraftWhenPreparationIsRequested() {
        when(publications.current(10L, 1L)).thenReturn(null);
        assertThat(service.current(10L)).isNull();
        verify(publications, never()).insert(any(DigitalEmployeePublication.class));
        assertThat(service.prepare(10L).publication().getStatus()).isEqualTo("DRAFT");
        verify(publications).insert(any(DigitalEmployeePublication.class));
    }

    @Test void draftCanOpenWithEditableConfigurationErrors() {
        when(publications.current(10L, 1L)).thenReturn(null);
        DigitalEmployeeDetailsDTO details = new DigitalEmployeeDetailsDTO();
        details.setAgentType("001"); details.setResourceId(10L); details.setResourceName("");
        when(employees.findDetailsById(any())).thenReturn(details);
        when(dependencies.capture(any(), anyLong(), anyLong(), anyLong()))
            .thenReturn(List.of(EmployeePublicationResources.blocker("技能配置", "请重新关联技能")));
        var draft = service.prepare(10L);
        assertThat(draft.canEdit()).isTrue();
        assertThat(draft.dependencies()).extracting(EmployeePublicationApplicationService.DependencyView::error)
            .contains("请重新关联技能", "员工名称必填且不能超过 300 个字符");
        verify(publications).insert(draft.publication());
        verify(dependencies, never()).validate(anyList(), anyLong(), anyLong());
    }

    @Test void newDraftUsesTheOriginalEmployeesTenantAndRejectsAnotherLoginTenant() {
        source.setComAcctId(37L);
        assertThatThrownBy(() -> service.prepare(10L)).hasMessageContaining("不存在");
        CurrentUserHolder.getLoginInfo().setEnterpriseId(37L);
        when(publications.lockResource(10L, 37L)).thenReturn(source);
        var draft = service.prepare(10L);
        assertThat(draft.publication().getTenantId()).isEqualTo(source.getComAcctId());
        verify(dependencies).capture(any(), eq(7L), eq(37L), anyLong());
    }

    @Test void savingDraftReplacesTheObsoleteDeploymentScopeError() {
        publication.setDependenciesJson(JSON.toJSONString(List.of(
            EmployeePublicationResources.blocker("发布范围", "发布范围与当前部署企业不一致"))));
        EmployeePublicationRequest update = request();
        update.setEmployee(JSON.parseObject(publication.getSnapshotJson(), DigitalEmployeeDTO.class));
        var saved = service.save(update);
        assertThat(saved.dependencies()).isEmpty();
        assertThat(publication.getDependenciesJson()).isEqualTo("[]");
        assertThat(service.submit(request()).publication().getStatus()).isEqualTo("PENDING");
    }

    @ParameterizedTest @ValueSource(strings = {"MCP", "KG_DOC", "SKILL"})
    void legacyPrivateResourceBlockerBecomesOmissionAndPublishedRuntimeExcludesIt(String type) {
        SsResource tool = employee(20L, 7L); tool.setResourceBizType(type); tool.setResourceName("个人资源");
        var dependency = new EmployeePublicationResources.Dependency();
        dependency.setResource(tool); dependency.setTargetId(20L); dependency.setAction("BLOCKED");
        dependency.setError("私有资源请先完成官方化");
        publication.setDependenciesJson(JSON.toJSONString(List.of(dependency)));
        var dto = JSON.parseObject(publication.getSnapshotJson(), DigitalEmployeeDTO.class);
        dto.setRelTools(List.of("*", "unknown")); dto.setRelIds(List.of(20L));
        publication.setSnapshotJson(JSON.toJSONString(dto));
        var draft = service.detail(100L);
        assertThat(draft.dependencies().getFirst().error()).isNull();
        assertThat(draft.dependencies().getFirst().warning()).contains("当前发布规则");
        service.submit(request());
        login("admin", 8L, List.of("PLAT_MAN"));
        doAnswer(call -> {
            List<EmployeePublicationResources.Dependency> rows = call.getArgument(0);
            rows.forEach(row -> { row.setAction("OMIT_RESOURCE"); row.setWarning("个人资源不带入企业员工"); });
            return null;
        }).when(dependencies).validate(anyList(), anyLong(), anyLong());
        doCallRealMethod().when(dependencies).applyPublishedResources(any(), anyList(), anyMap());
        when(employees.syncPublicationOpenClawWorkSpace(anyLong(), any())).thenReturn(true);
        var result = service.approve(request());
        assertThat(result.publication().getStatus()).isEqualTo("PUBLISHED");
        assertThat(result.dependencies().getFirst().action()).isEqualTo("OMIT_RESOURCE");
        verify(employees).syncPublicationOpenClawWorkSpace(anyLong(), argThat(snapshot ->
            snapshot.getRelTools().isEmpty() && snapshot.getRelIds().isEmpty() && snapshot.getRelSkills().isEmpty()));
        verify(relations, never()).save(any());
        assertThat(source.getOwnerType()).isEqualTo("personal");
    }

    @Test void newDraftKeepsLastReviewVisibleAndCopiesRejectedConfiguration() {
        publication.setStatus("REJECTED"); publication.setCreatedAt(new java.util.Date(1));
        publication.setReviewerName("审核管理员"); publication.setReviewedAt(new java.util.Date(2));
        publication.setComment("请修改岗位描述");
        when(publications.previousRejection(eq(10L), eq(1L), any(), eq(101L))).thenReturn(publication);
        var next = service.revise(request());
        assertThat(next.employee().getResourceName()).isEqualTo("员工(企业)");
        assertThat(next.previousReview().requestId()).isEqualTo("100");
        assertThat(next.previousReview().reviewerName()).isEqualTo("审核管理员");
        assertThat(next.previousReview().comment()).isEqualTo("请修改岗位描述");
        assertThat(publication.getStatus()).isEqualTo("REJECTED");
        assertThat(publication.getComment()).isEqualTo("请修改岗位描述");
        verify(employees, never()).findDetailsById(any());
    }

    @Test void historicalRejectionCannotReplaceANewerFinishedApplication() {
        publication.setStatus("REJECTED");
        var newer = new DigitalEmployeePublication(); newer.setRequestId(200L);
        when(publications.current(10L, 1L)).thenReturn(newer);
        assertThat(service.detail(100L).canRevise()).isFalse();
        assertThatThrownBy(() -> service.revise(request())).hasMessageContaining("已有后续记录");
        verify(publications, never()).insert(any(DigitalEmployeePublication.class));
    }

    @Test void officialEditingCreatesUpdateDraftWhileReadOnlyEntryShowsPublishedResult() {
        publication.setStatus("PUBLISHED"); publication.setOfficialId(90L);
        SsResource official = employee(90L, 7L); official.setOwnerType("enterprise"); official.setPublicationSourceId(10L);
        when(resources.selectById(90L)).thenReturn(official);
        when(publications.lockResource(90L, 1L)).thenReturn(official);
        when(publications.official(10L, 1L)).thenReturn(official);
        assertThat(service.current(90L).publication()).isSameAs(publication);
        verify(publications, never()).insert(any(DigitalEmployeePublication.class));
        var draft = service.prepare(90L).publication();
        assertThat(draft.getStatus()).isEqualTo("DRAFT");
        assertThat(draft.getOfficialId()).isEqualTo(90L);
        assertThat(draft.getRequestId()).isNotEqualTo(publication.getRequestId());
    }

    @Test void readonlyCurrentEntryEnforcesTenantAuthorEditionAndAdminvipProtection() {
        login("outsider", 9L, List.of());
        assertThatThrownBy(() -> service.current(10L)).isInstanceOf(BaseException.class);
        login("reviewer", 9L, List.of("PLAT_MAN"));
        assertThat(service.current(10L).publication()).isSameAs(publication);
        Users creator = new Users(); creator.setUserCode("adminvip"); when(users.findById(7L)).thenReturn(creator);
        assertThat(service.current(10L).canSubmit()).isTrue();
        assertThat(service.current(10L).publication().isRequiresAdminVipReview()).isFalse();
        login("adminvip", 7L, List.of()); source.setComAcctId(2L);
        assertThatThrownBy(() -> service.current(10L)).hasMessageContaining("不存在");
        source.setComAcctId(1L); when(config.getDcSystemConfigValueByCode("BYAI_BRAND_VERSION")).thenReturn("commercial");
        assertThat(service.current(10L).publication()).isSameAs(publication);
    }

    @Test void applyingAttemptCannotBeStartedTwice() {
        login("admin", 8L, List.of("PLAT_MAN")); publication.setStatus("APPLYING");
        publication.setUpdatedAt(new java.util.Date());
        assertThatThrownBy(() -> service.approve(request())).hasMessageContaining("当前申请状态");
        verify(resources, never()).insert(any(SsResource.class));
    }
    @Test void administratorCanRecoverAnAbandonedAttempt() {
        login("admin", 8L, List.of("PLAT_MAN")); publication.setStatus("APPLYING");
        publication.setUpdatedAt(new java.util.Date(0));
        when(employees.syncPublicationOpenClawWorkSpace(anyLong(), any())).thenReturn(true);
        assertThat(service.approve(request()).publication().getStatus()).isEqualTo("PUBLISHED");
    }
    @Test void reviewerMustUseLatestRevisionAfterCandidateEdit() {
        login("admin", 8L, List.of("PLAT_MAN")); publication.setStatus("PENDING");
        EmployeePublicationRequest old = request();
        EmployeePublicationRequest edit = request();
        DigitalEmployeeDTO dto = JSON.parseObject(publication.getSnapshotJson(), DigitalEmployeeDTO.class);
        dto.setResourceName("管理员修订"); edit.setEmployee(dto);
        service.save(edit);
        assertThatThrownBy(() -> service.approve(old)).hasMessageContaining("申请已被修改");
    }

    @Test void candidateNeverContainsPersonalChannelsMemoryOrCredentials() {
        DigitalEmployeeDTO dto = JSON.parseObject(publication.getSnapshotJson(), DigitalEmployeeDTO.class);
        dto.setMachineChannel("private-channel"); dto.setAgentSseHead("private-credential");
        dto.setAgentWebUrlOri("private-url"); dto.setTargetContent("private-runtime");
        DigitalEmployeeDTO snapshot = EmployeePublicationApplicationService.sanitize(dto, source);
        assertThat(snapshot.getMachineChannel()).isEqualTo("[]");
        assertThat(snapshot.getAgentSseHead()).isNull(); assertThat(snapshot.getAgentWebUrlOri()).isNull();
        assertThat(snapshot.getTargetContent()).isNull(); assertThat(snapshot.getMemoryConfigList()).isEmpty();
    }

    @Test void auditListOnlyOffersApprovalForAuthorizedReviewableRows() {
        when(publications.selectList(any())).thenReturn(List.of(publication));
        publication.setStatus("PENDING");
        assertThat(service.list(false, 1, 20).list().getFirst().isCanReview()).isFalse();
        login("platform", 8L, List.of("PLAT_MAN"));
        assertThat(service.list(true, 1, 20).list().getFirst().isCanReview()).isTrue();
        publication.setStatus("DRAFT");
        assertThat(service.list(true, 1, 20).list().getFirst().isCanReview()).isFalse();
        publication.setStatus("FAILED");
        Users creator = new Users(); creator.setUserCode("adminvip"); when(users.findById(7L)).thenReturn(creator);
        assertThat(service.list(true, 1, 20).list().getFirst().isCanReview()).isTrue();
        login("adminvip", 7L, List.of());
        assertThat(service.list(true, 1, 20).list().getFirst().isCanReview()).isTrue();
    }

    @ParameterizedTest @ValueSource(booleans = {false, true})
    void actualTransactionProxyCommitsLeaseRollsBackFailureAndAllowsRetry(boolean existing,
        @org.junit.jupiter.api.io.TempDir java.nio.file.Path directory) {
        login("platform", 8L, List.of("PLAT_MAN"));
        String url = "jdbc:sqlite:" + directory.resolve("publication.sqlite");
        var dataSource = new org.apache.ibatis.datasource.unpooled.UnpooledDataSource("org.sqlite.JDBC", url, null, null);
        var jdbc = new org.springframework.jdbc.core.JdbcTemplate(dataSource);
        // A distinct DataSource reads through a separate connection, outside the transaction under test.
        var committed = new org.springframework.jdbc.core.JdbcTemplate(
            new org.apache.ibatis.datasource.unpooled.UnpooledDataSource("org.sqlite.JDBC", url, null, null));
        jdbc.execute("CREATE TABLE request (status TEXT, revision BIGINT, official_id BIGINT, error TEXT)");
        jdbc.execute("CREATE TABLE resource (id BIGINT PRIMARY KEY, body TEXT)");
        jdbc.update("INSERT INTO request VALUES ('PENDING', 1, ?, NULL)", existing ? 90L : null);
        jdbc.update("INSERT INTO resource VALUES (10, ?)", JSON.toJSONString(source));
        if (existing) {
            SsResource official = employee(90L, 7L); official.setOwnerType("enterprise");
            official.setPublicationSourceId(10L); official.setResourceName("旧官方版本");
            jdbc.update("INSERT INTO resource VALUES (90, ?)", JSON.toJSONString(official));
        }
        var locked = new java.util.concurrent.atomic.AtomicReference<DigitalEmployeePublication>();
        java.util.function.Supplier<DigitalEmployeePublication> read = () -> jdbc.queryForObject("SELECT * FROM request", (rs, n) -> {
            var row = new DigitalEmployeePublication();
            org.springframework.beans.BeanUtils.copyProperties(publication, row);
            row.setStatus(rs.getString("status")); row.setRevision(rs.getLong("revision"));
            row.setOfficialId(rs.getObject("official_id") == null ? null : rs.getLong("official_id"));
            row.setPublishError(rs.getString("error")); return row;
        });
        when(publications.selectById(100L)).thenAnswer(call -> read.get());
        when(publications.lock(100L, 1L)).thenAnswer(call -> { locked.set(read.get()); return locked.get(); });
        when(publications.update(isNull(), any())).thenAnswer(call -> {
            var row = locked.get();
            return jdbc.update("UPDATE request SET status=?, revision=?, official_id=?, error=?",
                row.getStatus(), row.getRevision(), row.getOfficialId(), row.getPublishError());
        });
        when(resources.selectById(anyLong())).thenAnswer(call -> jdbc.query("SELECT body FROM resource WHERE id=?",
            (rs, n) -> JSON.parseObject(rs.getString(1), SsResource.class), (Long) call.getArgument(0)).stream().findFirst().orElse(null));
        when(publications.lockResource(anyLong(), eq(1L))).thenAnswer(call -> resources.selectById((Long) call.getArgument(0)));
        when(publications.official(10L, 1L)).thenAnswer(call -> existing ? resources.selectById(90L) : null);
        when(resources.insert(any(SsResource.class))).thenAnswer(call -> {
            SsResource row = call.getArgument(0);
            return jdbc.update("INSERT INTO resource VALUES (?,?)", row.getResourceId(), JSON.toJSONString(row));
        });
        when(resources.updateById(any(SsResource.class))).thenAnswer(call -> {
            SsResource row = call.getArgument(0);
            return jdbc.update("UPDATE resource SET body=? WHERE id=?", JSON.toJSONString(row), row.getResourceId());
        });
        var manager = new org.springframework.jdbc.datasource.DataSourceTransactionManager(dataSource);
        var advice = new com.iwhalecloud.byai.common.config.TransactionAdviceConfig();
        org.springframework.test.util.ReflectionTestUtils.setField(advice, "transactionManager", manager);
        var employeeFactory = new org.springframework.aop.framework.ProxyFactory(employees);
        employeeFactory.addAdvice(advice.getAdvisor());
        var txEmployees = (DigitalEmployeeApplicationService) employeeFactory.getProxy();
        service = new EmployeePublicationApplicationService(publications, resources, governance, txEmployees, dependencies,
            extensions, relations, mock(ResourceRuntimeInfoResolver.class), auth, sequence,
            new TransactionTemplate(manager), mock(DigEmployeeChangeEventPublisher.class));
        var factory = new org.springframework.aop.framework.ProxyFactory(service);
        factory.addAdvice(advice.getAdvisor());
        var proxied = (EmployeePublicationApplicationService) factory.getProxy();
        var succeeding = new java.util.concurrent.atomic.AtomicBoolean(false);
        when(employees.syncPublicationOpenClawWorkSpace(anyLong(), any())).thenAnswer(call -> {
            assertThat(org.springframework.transaction.support.TransactionSynchronizationManager.isActualTransactionActive()).isTrue();
            assertThat(committed.queryForObject("SELECT status FROM request", String.class)).isEqualTo("APPLYING");
            assertThat(resources.selectById((Long) call.getArgument(0)).getResourceName()).isEqualTo(existing ? "员工" : "员工(企业)");
            return succeeding.get();
        });
        doAnswer(call -> {
            assertThat(org.springframework.transaction.support.TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
            if (existing) assertThat(resources.selectById(90L).getResourceName()).isEqualTo("旧官方版本");
            else assertThat(resources.selectById((Long) call.getArgument(0))).isNull();
            throw new IllegalStateException("模拟补偿服务不可用，失败记录仍须提交");
        }).when(employees).restorePublicationRuntimeAfterRollback(anyLong());
        var failed = proxied.approve(request());
        assertThat(failed.publication().getStatus()).isEqualTo("FAILED");
        assertThat(read.get().getStatus()).isEqualTo("FAILED");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM resource", Integer.class)).isEqualTo(existing ? 2 : 1);
        if (existing) assertThat(resources.selectById(90L).getResourceName()).isEqualTo("旧官方版本");
        verify(employees).restorePublicationRuntimeAfterRollback(anyLong());
        succeeding.set(true);
        EmployeePublicationRequest retry = request(); retry.setRevision(read.get().getRevision());
        var published = proxied.approve(retry).publication();
        assertThat(published.getStatus()).isEqualTo("PUBLISHED");
        assertThat(read.get().getStatus()).isEqualTo("PUBLISHED");
        assertThat(read.get().getPublishError()).isNull();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM resource", Integer.class)).isEqualTo(2);
        assertThat(resources.selectById(published.getOfficialId()).getResourceName()).isEqualTo(existing ? "员工" : "员工(企业)");
        if (existing) assertThat(published.getOfficialId()).isEqualTo(90L);
    }
}
