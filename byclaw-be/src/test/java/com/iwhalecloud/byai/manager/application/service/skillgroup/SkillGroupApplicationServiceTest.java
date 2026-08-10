package com.iwhalecloud.byai.manager.application.service.skillgroup;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.github.pagehelper.Page;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.login.bean.UsersOrganization;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.constants.users.UserType;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceStatus;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtSkillService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtSkill;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.mapper.resource.SkillGroupMapper;
import com.iwhalecloud.byai.manager.qo.skillgroup.SkillGroupCreateQo;
import com.iwhalecloud.byai.manager.qo.skillgroup.SkillGroupInstallQo;
import com.iwhalecloud.byai.manager.qo.skillgroup.SkillGroupMemberChangeQo;
import com.iwhalecloud.byai.manager.qo.skillgroup.SkillGroupPageQo;
import com.iwhalecloud.byai.manager.qo.skillgroup.SkillGroupUpdateQo;
import com.iwhalecloud.byai.manager.vo.skillgroup.SkillGroupMemberVo;
import com.iwhalecloud.byai.manager.vo.skillgroup.SkillGroupInstallResultVo;
import com.iwhalecloud.byai.manager.vo.skillgroup.SkillGroupVo;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import java.util.Arrays;
import java.util.Date;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.transaction.annotation.Transactional;

class SkillGroupApplicationServiceTest {

    private static final Long USER_ID = 101L;
    private static final Long TENANT_ID = 201L;
    private static final Long GROUP_ID = 301L;

    private SsResourceService resourceService;
    private SsResourceRelDetailService relationService;
    private SkillGroupMapper mapper;
    private AuthApplicationService authService;
    private SequenceService sequenceService;
    private DigitalEmployeeApplicationService digitalEmployeeApplicationService;
    private SsResExtSkillService extSkillService;
    private ByaiSystemConfigService systemConfigService;
    private SkillGroupApplicationService service;

    @BeforeEach
    void setUp() {
        if (TableInfoHelper.getTableInfo(SsResourceRelDetail.class) == null) {
            TableInfoHelper.initTableInfo(
                    new MapperBuilderAssistant(new MybatisConfiguration(), ""), SsResourceRelDetail.class);
        }
        resourceService = mock(SsResourceService.class);
        relationService = mock(SsResourceRelDetailService.class);
        mapper = mock(SkillGroupMapper.class);
        authService = mock(AuthApplicationService.class);
        sequenceService = mock(SequenceService.class);
        digitalEmployeeApplicationService = mock(DigitalEmployeeApplicationService.class);
        extSkillService = mock(SsResExtSkillService.class);
        systemConfigService = mock(ByaiSystemConfigService.class);
        when(extSkillService.findByIds(any())).thenAnswer(invocation -> {
            Iterable<Long> resourceIds = invocation.getArgument(0);
            java.util.ArrayList<SsResExtSkill> result = new java.util.ArrayList<>();
            resourceIds.forEach(resourceId -> result.add(innerSkill(resourceId)));
            return result;
        });
        service = new SkillGroupApplicationService(
                resourceService, relationService, mapper, authService, sequenceService,
                digitalEmployeeApplicationService, extSkillService, systemConfigService);
        setCurrentUser("ordinary", UserType.ORD_USER);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void createPersonalBuildsFixedGroupResourceAndUsesDefaultResourceSaveOnly() {
        setCurrentUser("adminvip", UserType.ORD_USER);
        SkillGroupCreateQo qo = createQo("personal");
        when(resourceService.saveResource(any())).thenAnswer(invocation -> {
            SsResource saved = invocation.getArgument(0);
            saved.setResourceId(GROUP_ID);
            saved.setCreateBy(USER_ID);
            saved.setCreateTime(new Date(1_000L));
            saved.setUpdateTime(new Date(2_000L));
            return saved;
        });

        SkillGroupVo result = service.create(qo);

        ArgumentCaptor<SsResource> captor = ArgumentCaptor.forClass(SsResource.class);
        verify(resourceService).saveResource(captor.capture());
        SsResource saved = captor.getValue();
        assertThat(saved.getResourceBizType()).isEqualTo("SKILL_GROUP");
        assertThat(saved.getResourceType()).isEqualTo("COMBIN");
        assertThat(saved.getResourceStatus()).isEqualTo(ResourceStatus.LIST.getNum());
        assertThat(saved.getOwnerType()).isEqualTo("personal");
        assertThat(saved.getResourceName()).isEqualTo("Analysis group");
        assertThat(saved.getResourceDesc()).isEqualTo("description");
        assertThat(saved.getAvatar()).isEqualTo("avatar");
        assertThat(saved.getCatalogId()).isEqualTo(401L);
        assertThat(saved.getComAcctId()).isEqualTo(TENANT_ID);
        assertThat(result.getResourceId()).isEqualTo(GROUP_ID);
        assertThat(result.getMembers()).isEmpty();
        assertThat(Arrays.stream(SkillGroupApplicationService.class.getDeclaredFields())
                .map(field -> field.getType())
                .anyMatch(SsResExtSkillService.class::equals)).isTrue();
    }

    @Test
    void createPersonalRejectsMissingCurrentTenantBeforeSave() {
        setCurrentUser("adminvip", UserType.ORD_USER, null);

        assertThatThrownBy(() -> service.create(createQo("personal")))
                .isInstanceOf(BaseException.class)
                .hasMessageContaining("企业");

        verify(resourceService, never()).saveResource(any());
    }

    @Test
    void createEnterpriseRejectsMissingCurrentTenantBeforeSave() {
        setCurrentUser("adminvip", UserType.ORD_USER, null);

        assertThatThrownBy(() -> service.create(createQo("enterprise")))
                .isInstanceOf(BaseException.class)
                .hasMessageContaining("企业");

        verify(resourceService, never()).saveResource(any());
    }

    @Test
    void createEnterpriseFailsWithoutRequiredRoleAndDoesNotSave() {
        assertThatThrownBy(() -> service.create(createQo("enterprise")))
                .isInstanceOf(BaseException.class)
                .hasMessageContaining("企业");

        verify(resourceService, never()).saveResource(any());
    }

    @Test
    void createEnterpriseRejectsBusinessAdminWhenNotConfiguredAsAdminVip() {
        setCurrentUser("business-admin", UserType.BUSINESS_MAN);

        assertThatThrownBy(() -> service.create(createQo("enterprise")))
                .isInstanceOf(BaseException.class)
                .hasMessageContaining("AdminVip");
        verify(resourceService, never()).saveResource(any());
    }

    @Test
    void createEnterpriseAllowsConfiguredAdminVip() {
        setCurrentUser("alice", UserType.ORD_USER);
        when(systemConfigService.getDcSystemConfigValueByCode("USERCODE_CONFIG"))
                .thenReturn("[\"alice\",\"bob\"]");
        stubResourceSave();

        assertThat(service.create(createQo("enterprise")).getResourceId()).isEqualTo(GROUP_ID);

        verify(resourceService).saveResource(any(SsResource.class));
    }

    @Test
    void createEnterpriseAllowsAdminVip() {
        setCurrentUser("adminvip", UserType.ORD_USER);
        when(systemConfigService.getDcSystemConfigValueByCode("USERCODE_CONFIG"))
                .thenThrow(new IllegalStateException("config unavailable"));
        stubResourceSave();

        assertThat(service.create(createQo("enterprise")).getResourceId()).isEqualTo(GROUP_ID);

        verify(resourceService).saveResource(any(SsResource.class));
    }

    @Test
    void updateChangesOnlyEditableFieldsAfterManagementValidation() {
        SsResource group = group();
        group.setOwnerType("enterprise");
        group.setResourceStatus(2);
        group.setCreateBy(999L);
        group.setUpdateBy(999L);
        Date previousUpdateTime = new Date(1_000L);
        group.setUpdateTime(previousUpdateTime);
        when(mapper.selectGroupForUpdate(GROUP_ID, TENANT_ID)).thenReturn(group);
        when(authService.hasResourceManagePermission(group)).thenReturn(true);
        when(mapper.updateGroupFields(group, TENANT_ID)).thenReturn(1);
        SkillGroupUpdateQo qo = updateQo();

        SkillGroupVo result = service.update(qo);

        InOrder order = inOrder(mapper);
        order.verify(mapper).selectGroupForUpdate(GROUP_ID, TENANT_ID);
        order.verify(mapper).updateGroupFields(group, TENANT_ID);
        verify(resourceService, never()).updateResourceEntity(any());
        assertThat(group.getResourceName()).isEqualTo("Updated");
        assertThat(group.getResourceDesc()).isEqualTo("updated desc");
        assertThat(group.getAvatar()).isEqualTo("updated avatar");
        assertThat(group.getCatalogId()).isEqualTo(402L);
        assertThat(group.getOwnerType()).isEqualTo("enterprise");
        assertThat(group.getResourceStatus()).isEqualTo(2);
        assertThat(group.getCreateBy()).isEqualTo(999L);
        assertThat(group.getUpdateBy()).isEqualTo(USER_ID);
        assertThat(group.getUpdateTime()).isAfter(previousUpdateTime);
        assertThat(result.getResourceName()).isEqualTo("Updated");
    }

    @Test
    void updateFailsWhenScopedColumnUpdateAffectsNoRows() {
        SsResource group = group();
        when(mapper.selectGroupForUpdate(GROUP_ID, TENANT_ID)).thenReturn(group);
        when(authService.hasResourceManagePermission(group)).thenReturn(true);
        when(mapper.updateGroupFields(group, TENANT_ID)).thenReturn(0);

        assertThatThrownBy(() -> service.update(updateQo()))
                .isInstanceOf(BaseException.class)
                .hasMessageContaining("并发");

        verify(resourceService, never()).updateResourceEntity(any());
    }

    @Test
    void updateRejectsManageDeniedWrongTypeAndCrossTenantWithoutMutation() {
        SsResource denied = group();
        SsResource wrongType = group();
        wrongType.setResourceBizType("SKILL");
        SsResource otherTenant = group();
        otherTenant.setComAcctId(999L);
        when(mapper.selectGroupForUpdate(GROUP_ID, TENANT_ID))
                .thenReturn(denied, wrongType, otherTenant);
        when(authService.hasResourceManagePermission(denied)).thenReturn(false);
        assertThatThrownBy(() -> service.update(updateQo())).isInstanceOf(BaseException.class);

        assertThatThrownBy(() -> service.update(updateQo())).isInstanceOf(BaseException.class);

        assertThatThrownBy(() -> service.update(updateQo())).isInstanceOf(BaseException.class);

        verify(resourceService, never()).updateResourceEntity(any());
        verify(mapper, never()).updateGroupFields(any(), any());
    }

    @Test
    void allGroupMutationEntryPointsAreTransactional() throws Exception {
        assertThat(SkillGroupApplicationService.class
                .getMethod("update", SkillGroupUpdateQo.class)
                .isAnnotationPresent(Transactional.class)).isTrue();
        assertThat(SkillGroupApplicationService.class
                .getMethod("addMembers", SkillGroupMemberChangeQo.class)
                .isAnnotationPresent(Transactional.class)).isTrue();
        assertThat(SkillGroupApplicationService.class
                .getMethod("removeMembers", SkillGroupMemberChangeQo.class)
                .isAnnotationPresent(Transactional.class)).isTrue();
        assertThat(SkillGroupApplicationService.class
                .getMethod("delete", Long.class)
                .isAnnotationPresent(Transactional.class)).isTrue();
        assertThat(SkillGroupApplicationService.class
                .getMethod("install", SkillGroupInstallQo.class)
                .isAnnotationPresent(Transactional.class)).isTrue();
        assertThat(SkillGroupApplicationService.class
                .getMethod("uninstall", SkillGroupInstallQo.class)
                .isAnnotationPresent(Transactional.class)).isTrue();
    }

    @Test
    void installLocksGroupAndEmployeeBeforeMemberReadsValidatesSnapshotThenDelegatesInMemberOrder() {
        SsResource group = group();
        SsResource employee = digitalEmployee(401L);
        SsResource skill501 = skill(501L);
        SsResource skill502 = skill(502L);
        when(mapper.selectGroupForUpdate(GROUP_ID, TENANT_ID)).thenReturn(group);
        when(authService.hasResourceManagePermission(group)).thenReturn(false);
        when(authService.hasResourceUsePermission(group)).thenReturn(true);
        when(mapper.selectDigitalEmployeeForUpdate(401L, TENANT_ID)).thenReturn(employee);
        when(authService.hasResourceManagePermission(employee)).thenReturn(true);
        when(mapper.selectMemberRelations(GROUP_ID, null)).thenReturn(List.of(
                relation(11L, 502L, 1), relation(12L, 501L, 1), relation(13L, 502L, 1)));
        when(resourceService.findByIdList(List.of(502L, 501L))).thenReturn(List.of(skill501, skill502));
        when(authService.hasResourceUsePermission(skill501)).thenReturn(true);
        when(authService.hasResourceUsePermission(skill502)).thenReturn(true);
        SkillGroupInstallResultVo delegated = new SkillGroupInstallResultVo();
        delegated.setInstalledSkillIds(List.of(502L));
        delegated.setExistingSkillIds(List.of(501L));
        when(digitalEmployeeApplicationService.installSkillGroupSnapshot(employee, GROUP_ID, List.of(502L, 501L)))
                .thenReturn(delegated);

        SkillGroupInstallResultVo result = service.install(installQo(401L, GROUP_ID));

        assertThat(result.getTotalSkillIds()).containsExactly(502L, 501L);
        assertThat(result.getInstalledSkillIds()).containsExactly(502L);
        assertThat(result.getExistingSkillIds()).containsExactly(501L);
        InOrder order = inOrder(mapper, resourceService, digitalEmployeeApplicationService);
        order.verify(mapper).selectGroupForUpdate(GROUP_ID, TENANT_ID);
        order.verify(mapper).selectDigitalEmployeeForUpdate(401L, TENANT_ID);
        order.verify(mapper).selectMemberRelations(GROUP_ID, null);
        order.verify(resourceService).findByIdList(List.of(502L, 501L));
        order.verify(digitalEmployeeApplicationService)
                .installSkillGroupSnapshot(employee, GROUP_ID, List.of(502L, 501L));
    }

    @Test
    void installRejectsEmptyOrInvalidSnapshotBeforeMutation() {
        SsResource group = group();
        SsResource employee = digitalEmployee(401L);
        when(mapper.selectGroupForUpdate(GROUP_ID, TENANT_ID)).thenReturn(group);
        when(authService.hasResourceManagePermission(group)).thenReturn(true);
        when(mapper.selectDigitalEmployeeForUpdate(401L, TENANT_ID)).thenReturn(employee);
        when(authService.hasResourceManagePermission(employee)).thenReturn(true);
        when(mapper.selectMemberRelations(GROUP_ID, null)).thenReturn(List.of());

        assertThatThrownBy(() -> service.install(installQo(401L, GROUP_ID)))
                .isInstanceOf(BaseException.class);

        SsResource invalid = skill(501L);
        invalid.setResourceStatus(ResourceStatus.REMOVED.getNum());
        when(mapper.selectMemberRelations(GROUP_ID, null)).thenReturn(List.of(relation(11L, 501L, 1)));
        when(resourceService.findByIdList(List.of(501L))).thenReturn(List.of(invalid));
        assertThatThrownBy(() -> service.install(installQo(401L, GROUP_ID)))
                .isInstanceOf(BaseException.class);

        verifyNoInteractions(digitalEmployeeApplicationService);
    }

    @Test
    void installRejectsWrongTenantEmployeeOrManageDeniedBeforeMemberRead() {
        SsResource group = group();
        when(mapper.selectGroupForUpdate(GROUP_ID, TENANT_ID)).thenReturn(group);
        when(authService.hasResourceManagePermission(group)).thenReturn(true);
        when(mapper.selectDigitalEmployeeForUpdate(401L, TENANT_ID)).thenReturn(null);

        assertThatThrownBy(() -> service.install(installQo(401L, GROUP_ID)))
                .isInstanceOf(BaseException.class);

        SsResource employee = digitalEmployee(401L);
        when(mapper.selectDigitalEmployeeForUpdate(401L, TENANT_ID)).thenReturn(employee);
        when(authService.hasResourceManagePermission(employee)).thenReturn(false);
        assertThatThrownBy(() -> service.install(installQo(401L, GROUP_ID)))
                .isInstanceOf(BaseException.class);

        verify(mapper, never()).selectMemberRelations(any(), any());
        verifyNoInteractions(digitalEmployeeApplicationService);
    }

    @Test
    void uninstallLocksGroupAndEmployeeThenDelegatesWithoutReadingCurrentMembers() {
        SsResource group = group();
        SsResource employee = digitalEmployee(401L);
        when(mapper.selectGroupForUpdate(GROUP_ID, TENANT_ID)).thenReturn(group);
        when(authService.hasResourceManagePermission(group)).thenReturn(true);
        when(mapper.selectDigitalEmployeeForUpdate(401L, TENANT_ID)).thenReturn(employee);
        when(authService.hasResourceManagePermission(employee)).thenReturn(true);
        SkillGroupInstallResultVo delegated = new SkillGroupInstallResultVo();
        delegated.setTotalSkillIds(List.of(599L));
        delegated.setRemovedSkillIds(List.of(599L));
        when(digitalEmployeeApplicationService.uninstallSkillGroupSnapshot(employee, GROUP_ID))
                .thenReturn(delegated);

        SkillGroupInstallResultVo result = service.uninstall(installQo(401L, GROUP_ID));

        assertThat(result.getTotalSkillIds()).containsExactly(599L);
        assertThat(result.getRemovedSkillIds()).containsExactly(599L);
        verify(mapper, never()).selectMemberRelations(any(), any());
        verify(mapper, never()).selectActiveMembers(any());
        InOrder order = inOrder(mapper, digitalEmployeeApplicationService);
        order.verify(mapper).selectGroupForUpdate(GROUP_ID, TENANT_ID);
        order.verify(mapper).selectDigitalEmployeeForUpdate(401L, TENANT_ID);
        order.verify(digitalEmployeeApplicationService).uninstallSkillGroupSnapshot(employee, GROUP_ID);
    }

    @Test
    void installAndUninstallRejectMissingRequestIdsBeforeQueries() {
        assertThatThrownBy(() -> service.install(null)).isInstanceOf(BaseException.class);
        SkillGroupInstallQo missingEmployee = installQo(null, GROUP_ID);
        assertThatThrownBy(() -> service.install(missingEmployee)).isInstanceOf(BaseException.class);
        SkillGroupInstallQo missingGroup = installQo(401L, null);
        assertThatThrownBy(() -> service.uninstall(missingGroup)).isInstanceOf(BaseException.class);

        verifyNoInteractions(mapper, resourceService, relationService, authService, sequenceService,
                digitalEmployeeApplicationService);
    }

    @Test
    void pagePassesCurrentTenantAndUserAndConvertsPageHelperMetadata() {
        SkillGroupPageQo qo = new SkillGroupPageQo();
        qo.setPageNum(2);
        qo.setPageSize(5);
        Page<SkillGroupVo> rows = new Page<>(2, 5);
        SkillGroupVo group = new SkillGroupVo();
        group.setResourceId(GROUP_ID);
        rows.add(group);
        rows.setTotal(11);
        when(mapper.selectPage(qo, TENANT_ID, USER_ID)).thenReturn(rows);

        PageInfo<SkillGroupVo> result = service.page(qo);

        verify(mapper).selectPage(qo, TENANT_ID, USER_ID);
        assertThat(result.getList()).extracting(SkillGroupVo::getResourceId).containsExactly(GROUP_ID);
        assertThat(result.getPageNum()).isEqualTo(2);
        assertThat(result.getPageSize()).isEqualTo(5);
        assertThat(result.getTotal()).isEqualTo(11);
    }

    @Test
    void detailUsesVisibilityQueryAndPopulatesMembersWhileHiddenGroupFails() {
        SkillGroupVo visible = new SkillGroupVo();
        visible.setResourceId(GROUP_ID);
        SkillGroupMemberVo member = new SkillGroupMemberVo();
        member.setResourceId(501L);
        when(mapper.selectDetail(GROUP_ID, TENANT_ID, USER_ID)).thenReturn(visible);
        when(mapper.selectActiveMembers(GROUP_ID)).thenReturn(List.of(member));

        SkillGroupVo result = service.detail(GROUP_ID);

        assertThat(result.getMembers()).extracting(SkillGroupMemberVo::getResourceId).containsExactly(501L);
        when(mapper.selectDetail(999L, TENANT_ID, USER_ID)).thenReturn(null);
        assertThatThrownBy(() -> service.detail(999L)).isInstanceOf(BaseException.class);
    }

    @Test
    void addMembersDeduplicatesInputKeepsActiveReenablesInactiveAndInsertsAbsent() {
        prepareManagedGroup();
        SsResource skill1 = skill(501L);
        SsResource skill2 = skill(502L);
        SsResource skill3 = skill(503L);
        when(resourceService.findByIdList(List.of(501L, 502L, 503L))).thenReturn(List.of(skill1, skill2, skill3));
        when(authService.hasResourceUsePermission(any(SsResource.class))).thenReturn(true);
        SsResourceRelDetail active = relation(11L, 501L, 1);
        SsResourceRelDetail inactive = relation(12L, 502L, 0);
        when(mapper.selectMemberRelationsIncludingInactive(GROUP_ID, List.of(501L, 502L, 503L)))
                .thenReturn(List.of(active, inactive));
        when(relationService.updateById(inactive)).thenReturn(true);
        when(sequenceService.nextVal()).thenReturn(13L);
        SkillGroupMemberChangeQo qo = memberQo(501L, 502L, 501L, 503L);

        service.addMembers(qo);

        verify(mapper).selectMemberRelationsIncludingInactive(GROUP_ID, List.of(501L, 502L, 503L));
        verify(relationService).updateById(inactive);
        assertThat(inactive.getRelStatus()).isEqualTo(1);
        assertThat(inactive.getUpdateBy()).isEqualTo(USER_ID);
        assertThat(inactive.getUpdateTime()).isNotNull();
        verify(relationService, never()).updateById(active);
        ArgumentCaptor<SsResourceRelDetail> inserted = ArgumentCaptor.forClass(SsResourceRelDetail.class);
        InOrder order = inOrder(mapper, resourceService, relationService);
        order.verify(mapper).selectGroupForUpdate(GROUP_ID, TENANT_ID);
        order.verify(resourceService).findByIdList(List.of(501L, 502L, 503L));
        order.verify(mapper).selectMemberRelationsIncludingInactive(GROUP_ID, List.of(501L, 502L, 503L));
        order.verify(relationService).updateById(inactive);
        order.verify(mapper).insertActiveMemberIfAbsent(inserted.capture());
        assertThat(inserted.getValue().getResourceRelDetailId()).isEqualTo(13L);
        assertThat(inserted.getValue().getResourceId()).isEqualTo(GROUP_ID);
        assertThat(inserted.getValue().getRelResourceId()).isEqualTo(503L);
        assertThat(inserted.getValue().getRelTypeName()).isEqualTo("SKILL_GROUP_MEMBER");
        assertThat(inserted.getValue().getRelStatus()).isEqualTo(1);
        assertThat(inserted.getValue().getCreateBy()).isEqualTo(USER_ID);
        assertThat(inserted.getValue().getUpdateBy()).isEqualTo(USER_ID);
        assertThat(inserted.getValue().getComAcctId()).isEqualTo(TENANT_ID);
    }

    @Test
    void addMembersAllowsInnerSkillWithoutUseOrManagePermission() {
        prepareManagedGroup();
        SsResource sharedSkill = skill(501L);
        sharedSkill.setComAcctId(999L);
        when(resourceService.findByIdList(List.of(501L))).thenReturn(List.of(sharedSkill));
        when(mapper.selectMemberRelationsIncludingInactive(GROUP_ID, List.of(501L))).thenReturn(List.of());
        when(sequenceService.nextVal()).thenReturn(11L);

        service.addMembers(memberQo(501L));

        ArgumentCaptor<SsResourceRelDetail> inserted = ArgumentCaptor.forClass(SsResourceRelDetail.class);
        verify(mapper).insertActiveMemberIfAbsent(inserted.capture());
        assertThat(inserted.getValue().getRelResourceId()).isEqualTo(501L);
        assertThat(inserted.getValue().getComAcctId()).isEqualTo(TENANT_ID);
        verify(authService, never()).hasResourceUsePermission(sharedSkill);
        verify(authService, never()).hasResourceManagePermission(sharedSkill);
    }

    @Test
    void addMembersRejectsNullIdsBeforeAnyQueryOrMutation() {
        SkillGroupMemberChangeQo qo = new SkillGroupMemberChangeQo();
        qo.setGroupId(GROUP_ID);
        qo.setSkillIds(null);

        assertThatThrownBy(() -> service.addMembers(qo))
                .isInstanceOf(BaseException.class)
                .hasMessage("组内技能列表不能为空");

        verifyNoInteractions(resourceService, mapper, relationService, authService, sequenceService);
    }

    @Test
    void removeMembersRejectsEmptyIdsBeforeAnyQueryOrMutation() {
        assertThatThrownBy(() -> service.removeMembers(memberQo())).isInstanceOf(BaseException.class);

        verifyNoInteractions(resourceService, mapper, relationService, authService, sequenceService);
    }

    @Test
    void addMembersTreatsZeroInsertAsSuccessWhenExactRelationIsNowActive() {
        prepareManagedGroup();
        SsResource skill = skill(501L);
        when(resourceService.findByIdList(List.of(501L))).thenReturn(List.of(skill));
        when(authService.hasResourceUsePermission(skill)).thenReturn(true);
        SsResourceRelDetail concurrentActive = relation(12L, 501L, 1);
        when(mapper.selectMemberRelationsIncludingInactive(GROUP_ID, List.of(501L)))
                .thenReturn(List.of(), List.of(concurrentActive));
        when(sequenceService.nextVal()).thenReturn(11L);
        when(mapper.insertActiveMemberIfAbsent(any())).thenReturn(0);

        service.addMembers(memberQo(501L));

        verify(mapper, org.mockito.Mockito.times(2))
                .selectMemberRelationsIncludingInactive(GROUP_ID, List.of(501L));
        verifyNoInteractions(relationService);
    }

    @Test
    void addMembersDoesNotRecoverByQueryWhenInsertUnexpectedlyThrowsDuplicate() {
        prepareManagedGroup();
        SsResource skill = skill(501L);
        when(resourceService.findByIdList(List.of(501L))).thenReturn(List.of(skill));
        when(authService.hasResourceUsePermission(skill)).thenReturn(true);
        when(mapper.selectMemberRelationsIncludingInactive(GROUP_ID, List.of(501L))).thenReturn(List.of());
        doThrow(new DuplicateKeyException("duplicate"))
                .when(mapper).insertActiveMemberIfAbsent(any(SsResourceRelDetail.class));

        assertThatThrownBy(() -> service.addMembers(memberQo(501L)))
                .isInstanceOf(DuplicateKeyException.class);

        verify(mapper).selectMemberRelationsIncludingInactive(GROUP_ID, List.of(501L));
    }

    @Test
    void addMembersAcceptsZeroReactivationCountWhenConcurrentStateIsActive() {
        prepareManagedGroup();
        SsResource skill = skill(501L);
        when(resourceService.findByIdList(List.of(501L))).thenReturn(List.of(skill));
        when(authService.hasResourceUsePermission(skill)).thenReturn(true);
        SsResourceRelDetail inactive = relation(11L, 501L, 0);
        SsResourceRelDetail concurrentActive = relation(12L, 501L, 1);
        when(mapper.selectMemberRelationsIncludingInactive(GROUP_ID, List.of(501L)))
                .thenReturn(List.of(inactive), List.of(concurrentActive));
        when(relationService.updateById(inactive)).thenReturn(false);

        service.addMembers(memberQo(501L));

        verify(mapper, org.mockito.Mockito.times(2))
                .selectMemberRelationsIncludingInactive(GROUP_ID, List.of(501L));
    }

    @Test
    void addMembersValidatesWholeBatchBeforeAnyRelationMutation() {
        prepareManagedGroup();
        SsResource valid = skill(501L);
        SsResource invalid = skill(502L);
        invalid.setResourceStatus(ResourceStatus.REMOVED.getNum());
        when(resourceService.findByIdList(List.of(501L, 502L))).thenReturn(List.of(valid, invalid));
        when(authService.hasResourceUsePermission(valid)).thenReturn(true);

        assertThatThrownBy(() -> service.addMembers(memberQo(501L, 502L)))
                .isInstanceOf(BaseException.class)
                .hasMessage("组内技能未上架：502");

        verify(mapper, never()).selectMemberRelationsIncludingInactive(any(), any());
        verifyNoInteractions(relationService);
        verify(sequenceService, never()).nextVal();
    }

    @Test
    void addMembersRejectsMissingWrongTypeSelfAndNonInnerSkillBeforeMutation() {
        prepareManagedGroup();
        when(resourceService.findByIdList(List.of(501L))).thenReturn(List.of());
        assertThatThrownBy(() -> service.addMembers(memberQo(501L)))
                .isInstanceOf(BaseException.class)
                .hasMessage("组内技能不存在：501");

        SsResource wrong = skill(501L);
        wrong.setResourceBizType("TOOL");
        when(resourceService.findByIdList(List.of(501L))).thenReturn(List.of(wrong));
        assertThatThrownBy(() -> service.addMembers(memberQo(501L))).isInstanceOf(BaseException.class);

        when(resourceService.findByIdList(List.of(GROUP_ID))).thenReturn(List.of(group()));
        assertThatThrownBy(() -> service.addMembers(memberQo(GROUP_ID))).isInstanceOf(BaseException.class);

        SsResource nonInner = skill(501L);
        when(resourceService.findByIdList(List.of(501L))).thenReturn(List.of(nonInner));
        when(extSkillService.findByIds(List.of(501L))).thenReturn(List.of(hubSkill(501L)));
        assertThatThrownBy(() -> service.addMembers(memberQo(501L))).isInstanceOf(BaseException.class);

        verify(mapper, never()).selectMemberRelationsIncludingInactive(any(), any());
        verifyNoInteractions(relationService);
    }

    @Test
    void removeMembersDisablesActiveRowsAndTreatsMissingOrInactiveAsIdempotent() {
        prepareManagedGroup();
        SsResourceRelDetail active = relation(11L, 501L, 1);
        SsResourceRelDetail inactive = relation(12L, 502L, 0);
        when(mapper.selectMemberRelationsIncludingInactive(GROUP_ID, List.of(501L, 502L, 503L)))
                .thenReturn(List.of(active, inactive));
        when(relationService.updateById(active)).thenReturn(true);

        service.removeMembers(memberQo(501L, 502L, 501L, 503L));

        InOrder order = inOrder(mapper, relationService);
        order.verify(mapper).selectGroupForUpdate(GROUP_ID, TENANT_ID);
        order.verify(mapper).selectMemberRelationsIncludingInactive(GROUP_ID, List.of(501L, 502L, 503L));
        order.verify(relationService).updateById(active);
        verify(relationService, never()).updateById(inactive);
        assertThat(active.getRelStatus()).isZero();
        assertThat(active.getUpdateBy()).isEqualTo(USER_ID);
        assertThat(active.getUpdateTime()).isNotNull();
        verify(relationService, never()).removeById(any());
        verify(resourceService, never()).removeById(501L);
        verify(resourceService, never()).removeById(502L);
        verify(resourceService, never()).removeById(503L);
    }

    @Test
    void removeMembersFailsClearlyWhenZeroUpdateStillLeavesExactRelationActive() {
        prepareManagedGroup();
        SsResourceRelDetail active = relation(11L, 501L, 1);
        SsResourceRelDetail rereadActive = relation(11L, 501L, 1);
        when(mapper.selectMemberRelationsIncludingInactive(GROUP_ID, List.of(501L)))
                .thenReturn(List.of(active), List.of(rereadActive));
        when(relationService.updateById(active)).thenReturn(false);

        assertThatThrownBy(() -> service.removeMembers(memberQo(501L)))
                .isInstanceOf(BaseException.class)
                .hasMessageContaining("并发");
    }

    @Test
    void deleteIsBlockedWhenParsedSourceReferencesGroup() {
        prepareLockedManagedGroup();
        SsResourceRelDetail candidate = relation(21L, 501L, 1);
        candidate.setRelResourceInfo("{\"manual\":false,\"sourceGroupIds\":[301]}");
        when(mapper.selectSkillRelationsWithSourceInfoByTenant(TENANT_ID)).thenReturn(List.of(candidate));

        assertThatThrownBy(() -> service.delete(GROUP_ID))
                .isInstanceOf(BaseException.class)
                .hasMessageContaining("卸载");

        verify(relationService, never()).remove(any());
        verify(resourceService, never()).removeById(any());
        InOrder order = inOrder(mapper);
        order.verify(mapper).selectGroupForUpdate(GROUP_ID, TENANT_ID);
        order.verify(mapper).selectSkillRelationsWithSourceInfoByTenant(TENANT_ID);
    }

    @Test
    void deleteRejectsNonAdminVipBeforeLoadingGroup() {
        assertThatThrownBy(() -> service.delete(GROUP_ID))
                .isInstanceOf(BaseException.class)
                .hasMessageContaining("AdminVip");

        verify(mapper, never()).selectGroupForUpdate(any(), any());
        verifyNoInteractions(resourceService, relationService);
    }

    @Test
    void deleteRemainsBlockedWhenMalformedSourceContainsRecoverableGroupId() {
        prepareLockedManagedGroup();
        SsResourceRelDetail candidate = relation(21L, 501L, 1);
        candidate.setRelResourceInfo("{\"manual\":false,\"sourceGroupIds\":[301,\"bad\"]}");
        when(mapper.selectSkillRelationsWithSourceInfoByTenant(TENANT_ID)).thenReturn(List.of(candidate));

        assertThatThrownBy(() -> service.delete(GROUP_ID))
                .isInstanceOf(BaseException.class)
                .hasMessageContaining("卸载");

        verify(relationService, never()).remove(any());
        verify(resourceService, never()).removeById(any());
    }

    @Test
    void deleteBlocksAuthoritativeTenantCandidateDespiteNullOrStaleRelationTenant() {
        prepareLockedManagedGroup();
        SsResourceRelDetail nullTenant = relation(21L, 501L, 1);
        nullTenant.setComAcctId(null);
        nullTenant.setRelResourceInfo("{\"manual\":false,\"sourceGroupIds\":[301]}");
        SsResourceRelDetail staleTenant = relation(22L, 502L, 1);
        staleTenant.setComAcctId(999L);
        staleTenant.setRelResourceInfo("{\"manual\":false,\"sourceGroupIds\":[301]}");
        when(mapper.selectSkillRelationsWithSourceInfoByTenant(TENANT_ID))
                .thenReturn(List.of(nullTenant, staleTenant));

        assertThatThrownBy(() -> service.delete(GROUP_ID))
                .isInstanceOf(BaseException.class)
                .hasMessageContaining("卸载");

        verify(relationService, never()).remove(any());
        verify(resourceService, never()).removeById(any());
    }

    @Test
    void deleteTreatsMalformedLegacyAsManualAndDeletesOnlyMembershipRelationsAndGroup() {
        prepareLockedManagedGroup();
        SsResourceRelDetail malformed = relation(21L, 501L, 1);
        malformed.setRelResourceInfo("{not-json");
        when(mapper.selectSkillRelationsWithSourceInfoByTenant(TENANT_ID)).thenReturn(List.of(malformed));

        service.delete(GROUP_ID);

        ArgumentCaptor<LambdaQueryWrapper<SsResourceRelDetail>> wrapperCaptor =
                ArgumentCaptor.forClass(LambdaQueryWrapper.class);
        verify(relationService).remove(wrapperCaptor.capture());
        assertThat(wrapperCaptor.getValue().getSqlSegment()).contains("resource_id", "rel_type_name");
        assertThat(wrapperCaptor.getValue().getParamNameValuePairs().values())
                .contains(GROUP_ID, "SKILL_GROUP_MEMBER");
        verify(resourceService).removeById(GROUP_ID);
        verify(resourceService, never()).removeById(501L);
        verify(relationService, never()).removeById(21L);
        InOrder order = inOrder(mapper, relationService, resourceService);
        order.verify(mapper).selectGroupForUpdate(GROUP_ID, TENANT_ID);
        order.verify(mapper).selectSkillRelationsWithSourceInfoByTenant(TENANT_ID);
        order.verify(relationService).remove(any());
        order.verify(resourceService).removeById(GROUP_ID);
    }

    private void prepareManagedGroup() {
        SsResource group = group();
        when(mapper.selectGroupForUpdate(GROUP_ID, TENANT_ID)).thenReturn(group);
        when(mapper.insertActiveMemberIfAbsent(any())).thenReturn(1);
        when(authService.hasResourceManagePermission(group)).thenReturn(true);
    }

    private void prepareLockedManagedGroup() {
        setCurrentUser("adminvip", UserType.ORD_USER);
        SsResource group = group();
        when(mapper.selectGroupForUpdate(GROUP_ID, TENANT_ID)).thenReturn(group);
        when(authService.hasResourceManagePermission(group)).thenReturn(true);
    }

    private static void setCurrentUser(String userCode, String userType) {
        setCurrentUser(userCode, userType, TENANT_ID);
    }

    private static void setCurrentUser(String userCode, String userType, Long tenantId) {
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(USER_ID);
        loginInfo.setUserCode(userCode);
        loginInfo.setEnterpriseId(tenantId);
        UsersOrganization organization = new UsersOrganization();
        organization.setUserType(userType);
        loginInfo.setUsersOrganizations(List.of(organization));
        CurrentUserHolder.setLoginInfo(loginInfo);
    }

    private void stubResourceSave() {
        when(resourceService.saveResource(any())).thenAnswer(invocation -> {
            SsResource saved = invocation.getArgument(0);
            saved.setResourceId(GROUP_ID);
            return saved;
        });
    }

    private static SkillGroupCreateQo createQo(String ownerType) {
        SkillGroupCreateQo qo = new SkillGroupCreateQo();
        qo.setResourceName("Analysis group");
        qo.setResourceDesc("description");
        qo.setAvatar("avatar");
        qo.setCatalogId(401L);
        qo.setOwnerType(ownerType);
        return qo;
    }

    private static SkillGroupUpdateQo updateQo() {
        SkillGroupUpdateQo qo = new SkillGroupUpdateQo();
        qo.setGroupId(GROUP_ID);
        qo.setResourceName("Updated");
        qo.setResourceDesc("updated desc");
        qo.setAvatar("updated avatar");
        qo.setCatalogId(402L);
        return qo;
    }

    private static SkillGroupMemberChangeQo memberQo(Long... skillIds) {
        SkillGroupMemberChangeQo qo = new SkillGroupMemberChangeQo();
        qo.setGroupId(GROUP_ID);
        qo.setSkillIds(List.of(skillIds));
        return qo;
    }

    private static SkillGroupInstallQo installQo(Long employeeId, Long groupId) {
        SkillGroupInstallQo qo = new SkillGroupInstallQo();
        qo.setDigitalEmployeeId(employeeId);
        qo.setGroupId(groupId);
        return qo;
    }

    private static SsResource group() {
        SsResource resource = new SsResource();
        resource.setResourceId(GROUP_ID);
        resource.setResourceBizType("SKILL_GROUP");
        resource.setResourceType("COMBIN");
        resource.setResourceName("Group");
        resource.setComAcctId(TENANT_ID);
        return resource;
    }

    private static SsResource skill(Long id) {
        SsResource resource = new SsResource();
        resource.setResourceId(id);
        resource.setResourceBizType("SKILL");
        resource.setResourceStatus(ResourceStatus.LIST.getNum());
        return resource;
    }

    private static SsResource digitalEmployee(Long id) {
        SsResource resource = new SsResource();
        resource.setResourceId(id);
        resource.setResourceBizType("DIG_EMPLOYEE");
        resource.setComAcctId(TENANT_ID);
        return resource;
    }

    private static SsResExtSkill innerSkill(Long resourceId) {
        SsResExtSkill extSkill = new SsResExtSkill();
        extSkill.setResourceId(resourceId);
        extSkill.setSkillType(SsResExtSkillService.INNER_SKILL_TYPE);
        return extSkill;
    }

    private static SsResExtSkill hubSkill(Long resourceId) {
        SsResExtSkill extSkill = new SsResExtSkill();
        extSkill.setResourceId(resourceId);
        extSkill.setSkillType("hub");
        return extSkill;
    }

    private static SsResourceRelDetail relation(Long id, Long skillId, int status) {
        SsResourceRelDetail relation = new SsResourceRelDetail();
        relation.setResourceRelDetailId(id);
        relation.setResourceId(GROUP_ID);
        relation.setRelResourceId(skillId);
        relation.setRelTypeName("SKILL_GROUP_MEMBER");
        relation.setRelStatus(status);
        return relation;
    }
}
