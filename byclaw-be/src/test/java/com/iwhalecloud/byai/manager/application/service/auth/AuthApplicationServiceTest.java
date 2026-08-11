package com.iwhalecloud.byai.manager.application.service.auth;

import com.iwhalecloud.byai.common.constants.resource.OwnerType;
import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.common.constants.users.UserType;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.login.bean.UsersOrganization;
import com.iwhalecloud.byai.manager.domain.auth.enums.GrantToObjType;
import com.iwhalecloud.byai.manager.domain.auth.enums.GrantType;
import com.iwhalecloud.byai.manager.domain.auth.enums.Color;
import com.iwhalecloud.byai.manager.domain.auth.enums.OperType;
import com.iwhalecloud.byai.manager.domain.auth.model.UseApplyOutcome;
import com.iwhalecloud.byai.manager.domain.auth.service.PrivilegeGrantService;
import com.iwhalecloud.byai.manager.domain.organization.service.OrganizationService;
import com.iwhalecloud.byai.manager.domain.position.service.PositionService;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceBizTypeEnum;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.skillgroup.event.SkillUsePermissionChangedEvent;
import com.iwhalecloud.byai.manager.domain.station.service.StationService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.dto.auth.AuthDTO;
import com.iwhalecloud.byai.manager.dto.auth.AuthRedBlackDTO;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.entity.organization.Organization;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.station.Station;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.auth.PrivilegeGrantMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.manager.mapper.users.UsersMapper;
import com.iwhalecloud.byai.manager.qo.auth.AuthDetailQo;
import com.iwhalecloud.byai.manager.qo.auth.PrivilegeGrantQo;
import com.iwhalecloud.byai.manager.qo.auth.ResourceMemberQueryQo;
import com.iwhalecloud.byai.manager.qo.auth.ResourceUseApplyApproveQo;
import com.iwhalecloud.byai.manager.qo.auth.ResourceUseApplyQo;
import com.iwhalecloud.byai.manager.qo.auth.ResourceMemberSettingQo;
import com.iwhalecloud.byai.manager.dto.position.PositionDTO;
import com.iwhalecloud.byai.manager.vo.auth.ResourceMemberItemVo;
import com.iwhalecloud.byai.manager.vo.auth.ResourceMemberQueryResultVo;
import com.iwhalecloud.byai.manager.vo.auth.ResourceOperationPermissionsVo;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.context.MessageSource;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.redis.core.SetOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.util.ReflectionTestUtils;

import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;

import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.ArrayList;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;

class AuthApplicationServiceTest {

    @ParameterizedTest
    @ValueSource(strings = {Color.RED, Color.BLACK})
    void handleAuth_publishesExactSkillUsePermissionEventForPersistedRedOrBlackChange(String color) {
        mockRedisSetWrite();
        AuthApplicationService service = new AuthApplicationService();
        PrivilegeGrantService grants = mock(PrivilegeGrantService.class);
        PrivilegeGrantMapper grantMapper = mock(PrivilegeGrantMapper.class);
        SsResourceMapper resources = mock(SsResourceMapper.class);
        ApplicationEventPublisher publisher = mock(ApplicationEventPublisher.class);
        ReflectionTestUtils.setField(service, "privilegeGrantService", grants);
        ReflectionTestUtils.setField(service, "privilegeGrantMapper", grantMapper);
        ReflectionTestUtils.setField(service, "ssResourceMapper", resources);
        ReflectionTestUtils.setField(service, "eventPublisher", publisher);
        ReflectionTestUtils.setField(service, "authRedisSyncService", mock(AuthRedisSyncService.class));
        when(grants.findPrivilegeGrant(anyString(), anyString(), eq(301L), anyString())).thenReturn(List.of());
        when(grants.save(any())).thenReturn(true);
        SsResource skill = new SsResource();
        skill.setResourceId(301L);
        skill.setComAcctId(201L);
        skill.setResourceBizType(ResourceBizTypeEnum.SKILL.name());
        when(resources.selectById(301L)).thenReturn(skill);

        AuthDTO user = new AuthDTO();
        user.setGrantToObjType(GrantToObjType.USER);
        user.setGrantToObjId(11L);
        AuthRedBlackDTO dto = new AuthRedBlackDTO();
        dto.setGrantType(GrantType.AVAILABLE_USE);
        dto.setGrantObjType(ResourceBizTypeEnum.SKILL.name());
        dto.setGrantObjId(301L);
        dto.setRedList(Color.RED.equals(color) ? List.of(user) : List.of());
        dto.setBlackList(Color.BLACK.equals(color) ? List.of(user) : List.of());

        service.handleAuth(dto);

        verify(publisher).publishEvent(org.mockito.ArgumentMatchers.<Object>argThat(
            event -> event instanceof SkillUsePermissionChangedEvent changed
            && changed.skillResourceId().equals(301L)
            && changed.comAcctId().equals(201L)
            && changed.affectedUserIds().equals(java.util.Set.of(11L))));
    }

    @Test
    void handleAuth_eventContainsOnlyAddDeleteUsersWhenAnotherUserHasUpdateOnlyDelta() {
        mockRedisSetWrite();
        AuthApplicationService service = eventPublishingService(301L);
        PrivilegeGrantService grants = (PrivilegeGrantService)ReflectionTestUtils.getField(service,
            "privilegeGrantService");
        PrivilegeGrant updateOnly = grant(301L, 22L, Color.RED);
        updateOnly.setAllowUnsubscribe(Constants.ALLOW_UNSUBSCRIBE);
        when(grants.findPrivilegeGrant(GrantType.AVAILABLE_USE, ResourceBizTypeEnum.SKILL.name(), 301L, Color.RED))
            .thenReturn(List.of(updateOnly));
        when(grants.findPrivilegeGrant(GrantType.AVAILABLE_USE, ResourceBizTypeEnum.SKILL.name(), 301L, Color.BLACK))
            .thenReturn(List.of());
        when(grants.save(any())).thenReturn(true);

        AuthDTO added = authUser(11L);
        AuthDTO updated = authUser(22L);
        AuthRedBlackDTO dto = skillUseDto(301L);
        dto.setAllowUnSubscribe(false);
        dto.setRedList(List.of(added, updated));

        service.handleAuth(dto);

        ApplicationEventPublisher publisher = (ApplicationEventPublisher)ReflectionTestUtils.getField(service,
            "eventPublisher");
        verify(publisher).publishEvent(org.mockito.ArgumentMatchers.<Object>argThat(
            event -> event instanceof SkillUsePermissionChangedEvent changed
                && changed.affectedUserIds().equals(java.util.Set.of(11L))));
    }

    @ParameterizedTest
    @ValueSource(strings = {GrantToObjType.ORG, GrantToObjType.POST, GrantToObjType.STATION})
    void handleAuth_strictTargetResolutionFailurePropagatesWithoutPublishing(String targetType) {
        mockRedisSetWrite();
        AuthApplicationService service = eventPublishingService(301L);
        PrivilegeGrantService grants = (PrivilegeGrantService)ReflectionTestUtils.getField(service,
            "privilegeGrantService");
        UsersMapper usersMapper = mock(UsersMapper.class);
        ReflectionTestUtils.setField(service, "usersMapper", usersMapper);
        when(grants.findPrivilegeGrant(anyString(), anyString(), eq(301L), anyString())).thenReturn(List.of());
        when(grants.save(any())).thenReturn(true);
        if (GrantToObjType.ORG.equals(targetType)) {
            when(usersMapper.findUserIdsByOrgIdListIncludingChildren(any())).thenThrow(new IllegalStateException("org"));
        } else if (GrantToObjType.POST.equals(targetType)) {
            when(usersMapper.findUserIdsByPostId(88L)).thenThrow(new IllegalStateException("post"));
        } else {
            when(usersMapper.findUserIdsByStationIdListIncludingChildren(any()))
                .thenThrow(new IllegalStateException("station"));
        }
        AuthDTO target = new AuthDTO();
        target.setGrantToObjType(targetType);
        target.setGrantToObjId(88L);
        AuthRedBlackDTO dto = skillUseDto(301L);
        dto.setRedList(List.of(target));

        assertThatThrownBy(() -> service.handleAuth(dto)).isInstanceOf(IllegalStateException.class);

        ApplicationEventPublisher publisher = (ApplicationEventPublisher)ReflectionTestUtils.getField(service,
            "eventPublisher");
        verify(publisher, never()).publishEvent(any());
    }

    @Test
    void handleAuth_saveFailureThrowsAndDoesNotPublish() {
        mockRedisSetWrite();
        AuthApplicationService service = eventPublishingService(301L);
        PrivilegeGrantService grants = (PrivilegeGrantService)ReflectionTestUtils.getField(service,
            "privilegeGrantService");
        when(grants.findPrivilegeGrant(anyString(), anyString(), eq(301L), anyString())).thenReturn(List.of());
        when(grants.save(any())).thenReturn(false);
        AuthRedBlackDTO dto = skillUseDto(301L);
        dto.setRedList(List.of(authUser(11L)));

        assertThatThrownBy(() -> service.handleAuth(dto)).isInstanceOf(BaseException.class);
        ApplicationEventPublisher publisher = (ApplicationEventPublisher)ReflectionTestUtils.getField(service,
            "eventPublisher");
        verify(publisher, never()).publishEvent(any());
    }

    @ParameterizedTest
    @ValueSource(strings = {Color.RED, Color.BLACK})
    void handleAuth_publishesExactEventForSuccessfulDelete(String color) {
        mockRedisSetWrite();
        AuthApplicationService service = eventPublishingService(301L);
        PrivilegeGrantService grants = (PrivilegeGrantService)ReflectionTestUtils.getField(service,
            "privilegeGrantService");
        when(grants.findPrivilegeGrant(GrantType.AVAILABLE_USE, ResourceBizTypeEnum.SKILL.name(), 301L, color))
            .thenReturn(List.of(grant(301L, 11L, color)));
        when(grants.findPrivilegeGrant(GrantType.AVAILABLE_USE, ResourceBizTypeEnum.SKILL.name(), 301L,
            Color.RED.equals(color) ? Color.BLACK : Color.RED)).thenReturn(List.of());
        when(grants.remove(any())).thenReturn(true);

        service.handleAuth(skillUseDto(301L));

        ApplicationEventPublisher publisher = (ApplicationEventPublisher)ReflectionTestUtils.getField(service,
            "eventPublisher");
        verify(publisher).publishEvent(org.mockito.ArgumentMatchers.<Object>argThat(
            event -> event instanceof SkillUsePermissionChangedEvent changed
                && changed.affectedUserIds().equals(java.util.Set.of(11L))));
    }

    @Test
    void handleAuth_removeFailureThrowsAndDoesNotPublish() {
        mockRedisSetWrite();
        AuthApplicationService service = eventPublishingService(301L);
        PrivilegeGrantService grants = (PrivilegeGrantService)ReflectionTestUtils.getField(service,
            "privilegeGrantService");
        when(grants.findPrivilegeGrant(GrantType.AVAILABLE_USE, ResourceBizTypeEnum.SKILL.name(), 301L, Color.RED))
            .thenReturn(List.of(grant(301L, 11L, Color.RED)));
        when(grants.findPrivilegeGrant(GrantType.AVAILABLE_USE, ResourceBizTypeEnum.SKILL.name(), 301L, Color.BLACK))
            .thenReturn(List.of());
        when(grants.remove(any())).thenReturn(false);

        assertThatThrownBy(() -> service.handleAuth(skillUseDto(301L))).isInstanceOf(BaseException.class);
        ApplicationEventPublisher publisher = (ApplicationEventPublisher)ReflectionTestUtils.getField(service,
            "eventPublisher");
        verify(publisher, never()).publishEvent(any());
    }

    private AuthApplicationService eventPublishingService(Long resourceId) {
        AuthApplicationService service = new AuthApplicationService();
        ReflectionTestUtils.setField(service, "privilegeGrantService", mock(PrivilegeGrantService.class));
        ReflectionTestUtils.setField(service, "privilegeGrantMapper", mock(PrivilegeGrantMapper.class));
        SsResourceMapper resources = mock(SsResourceMapper.class);
        ReflectionTestUtils.setField(service, "ssResourceMapper", resources);
        ReflectionTestUtils.setField(service, "eventPublisher", mock(ApplicationEventPublisher.class));
        ReflectionTestUtils.setField(service, "authRedisSyncService", mock(AuthRedisSyncService.class));
        SsResource skill = new SsResource();
        skill.setResourceId(resourceId);
        skill.setComAcctId(201L);
        skill.setResourceBizType(ResourceBizTypeEnum.SKILL.name());
        when(resources.selectById(resourceId)).thenReturn(skill);
        return service;
    }

    private AuthRedBlackDTO skillUseDto(Long resourceId) {
        AuthRedBlackDTO dto = new AuthRedBlackDTO();
        dto.setGrantType(GrantType.AVAILABLE_USE);
        dto.setGrantObjType(ResourceBizTypeEnum.SKILL.name());
        dto.setGrantObjId(resourceId);
        dto.setRedList(List.of());
        dto.setBlackList(List.of());
        return dto;
    }

    private AuthDTO authUser(Long userId) {
        AuthDTO user = new AuthDTO();
        user.setGrantToObjType(GrantToObjType.USER);
        user.setGrantToObjId(userId);
        return user;
    }

    private PrivilegeGrant grant(Long resourceId, Long userId, String color) {
        PrivilegeGrant grant = new PrivilegeGrant();
        grant.setGrantType(GrantType.AVAILABLE_USE);
        grant.setGrantObjType(ResourceBizTypeEnum.SKILL.name());
        grant.setGrantObjId(resourceId);
        grant.setGrantToObjType(GrantToObjType.USER);
        grant.setGrantToObjId(userId);
        grant.setGrantToType(color);
        grant.setOperType(OperType.READ);
        return grant;
    }

    @Test
    void handleAuth_doesNotPublishForNonSkillManageNoChangeOrNoAffectedUsers() {
        AuthApplicationService service = new AuthApplicationService();
        PrivilegeGrantService grants = mock(PrivilegeGrantService.class);
        PrivilegeGrantMapper grantMapper = mock(PrivilegeGrantMapper.class);
        SsResourceMapper resources = mock(SsResourceMapper.class);
        ApplicationEventPublisher publisher = mock(ApplicationEventPublisher.class);
        ReflectionTestUtils.setField(service, "privilegeGrantService", grants);
        ReflectionTestUtils.setField(service, "privilegeGrantMapper", grantMapper);
        ReflectionTestUtils.setField(service, "ssResourceMapper", resources);
        ReflectionTestUtils.setField(service, "eventPublisher", publisher);
        ReflectionTestUtils.setField(service, "authRedisSyncService", mock(AuthRedisSyncService.class));
        when(grants.findPrivilegeGrant(anyString(), anyString(), any(), anyString())).thenReturn(List.of());
        when(grants.save(any())).thenReturn(true);
        when(grants.remove(any())).thenReturn(true);

        AuthRedBlackDTO noChange = new AuthRedBlackDTO();
        noChange.setGrantType(GrantType.AVAILABLE_USE);
        noChange.setGrantObjType(ResourceBizTypeEnum.SKILL.name());
        noChange.setGrantObjId(301L);
        noChange.setRedList(List.of());
        noChange.setBlackList(List.of());
        service.handleAuth(noChange);

        AuthDTO user = new AuthDTO();
        user.setGrantToObjType(GrantToObjType.USER);
        user.setGrantToObjId(11L);
        AuthRedBlackDTO nonSkill = new AuthRedBlackDTO();
        nonSkill.setGrantType(GrantType.AVAILABLE_USE);
        nonSkill.setGrantObjType(ResourceBizTypeEnum.AGENT.name());
        nonSkill.setGrantObjId(302L);
        nonSkill.setRedList(List.of(user));
        service.handleAuth(nonSkill);

        UsersMapper usersMapper = mock(UsersMapper.class);
        ReflectionTestUtils.setField(service, "usersMapper", usersMapper);
        SsResource skill = new SsResource();
        skill.setResourceId(303L);
        skill.setComAcctId(201L);
        skill.setResourceBizType(ResourceBizTypeEnum.SKILL.name());
        when(resources.selectById(303L)).thenReturn(skill);
        AuthDTO emptyOrg = new AuthDTO();
        emptyOrg.setGrantToObjType(GrantToObjType.ORG);
        emptyOrg.setGrantToObjId(88L);
        AuthRedBlackDTO noAffectedUsers = new AuthRedBlackDTO();
        noAffectedUsers.setGrantType(GrantType.AVAILABLE_USE);
        noAffectedUsers.setGrantObjType(ResourceBizTypeEnum.SKILL.name());
        noAffectedUsers.setGrantObjId(303L);
        noAffectedUsers.setRedList(List.of(emptyOrg));
        service.handleAuth(noAffectedUsers);

        SsResource managedSkill = new SsResource();
        managedSkill.setResourceId(304L);
        managedSkill.setComAcctId(201L);
        managedSkill.setResourceBizType(ResourceBizTypeEnum.SKILL.name());
        when(resources.selectById(304L)).thenReturn(managedSkill);
        PrivilegeGrant oldManage = new PrivilegeGrant();
        oldManage.setGrantType(GrantType.ALLOW_MANAGE);
        oldManage.setGrantObjType(ResourceBizTypeEnum.SKILL.name());
        oldManage.setGrantObjId(304L);
        oldManage.setGrantToObjType(GrantToObjType.USER);
        oldManage.setGrantToObjId(11L);
        oldManage.setGrantToType(Color.RED);
        oldManage.setOperType(OperType.READ);
        when(grants.findPrivilegeGrant(GrantType.ALLOW_MANAGE, ResourceBizTypeEnum.SKILL.name(), 304L, Color.RED))
            .thenReturn(List.of(oldManage));
        AuthRedBlackDTO manageOnly = new AuthRedBlackDTO();
        manageOnly.setGrantType(GrantType.ALLOW_MANAGE);
        manageOnly.setGrantObjType(ResourceBizTypeEnum.SKILL.name());
        manageOnly.setGrantObjId(304L);
        manageOnly.setRedList(List.of());
        manageOnly.setBlackList(List.of());
        service.handleAuth(manageOnly);

        verify(publisher, never()).publishEvent(any());
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    private void mockRedisSetWrite() {
        RedisUtil redisUtil = new RedisUtil();
        StringRedisTemplate stringRedisTemplate = mock(StringRedisTemplate.class);
        @SuppressWarnings("unchecked")
        SetOperations<String, String> setOperations = mock(SetOperations.class);
        when(stringRedisTemplate.opsForSet()).thenReturn(setOperations);
        ReflectionTestUtils.setField(redisUtil, "stringRedisTemplate", stringRedisTemplate);
        ReflectionTestUtils.setField(RedisUtil.class, "instance", redisUtil);
    }

    private void mockI18n() {
        MessageSource messageSource = mock(MessageSource.class);
        when(messageSource.getMessage(anyString(), any(Object[].class), any(Locale.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messageSource);
    }

    private void mockEmptyUsePermissionDependencies(AuthApplicationService service) {
        PrivilegeGrantService privilegeGrantService = mock(PrivilegeGrantService.class);
        OrganizationService organizationService = mock(OrganizationService.class);
        PositionService positionService = mock(PositionService.class);
        StationService stationService = mock(StationService.class);
        ReflectionTestUtils.setField(service, "privilegeGrantService", privilegeGrantService);
        ReflectionTestUtils.setField(service, "organizationService", organizationService);
        ReflectionTestUtils.setField(service, "positionService", positionService);
        ReflectionTestUtils.setField(service, "stationService", stationService);
        if (ReflectionTestUtils.getField(service, "privilegeGrantMapper") == null) {
            ReflectionTestUtils.setField(service, "privilegeGrantMapper", mock(PrivilegeGrantMapper.class));
        }
        when(privilegeGrantService.findPrivilegeByQo(any())).thenReturn(new ArrayList<>());
        when(organizationService.findOrganizationByUserId(any())).thenReturn(List.of());
        when(positionService.findPositionByUserId(any())).thenReturn(List.of());
        when(stationService.getStationByUserId(any())).thenReturn(null);
    }

    @ParameterizedTest
    @ValueSource(strings = {
        UserType.PLAT_MAN,
        UserType.PLAT_DEVOPS,
        UserType.BUSINESS_MAN
    })
    void hasResourceManagePermission_allowsGlobalAdministratorRoles(String userType) {
        AuthApplicationService service = new AuthApplicationService();
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(2L);
        loginInfo.setUserCode("manager");
        UsersOrganization administratorRole = new UsersOrganization();
        administratorRole.setUserType(userType);
        loginInfo.setUsersOrganizations(List.of(administratorRole));
        CurrentUserHolder.setLoginInfo(loginInfo);
        SsResource resource = new SsResource();
        resource.setCreateBy(1L);

        assertThat(service.hasResourceManagePermission(resource)).isTrue();
    }

    @Test
    void hasResourceManagePermission_allowsAdminVip() {
        AuthApplicationService service = new AuthApplicationService();
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(2L);
        loginInfo.setUserCode("adminvip");
        CurrentUserHolder.setLoginInfo(loginInfo);
        SsResource resource = new SsResource();
        resource.setCreateBy(1L);

        assertThat(service.hasResourceManagePermission(resource)).isTrue();
    }

    @Test
    void hasResourceManagePermission_allowsOrganizationAdminForManagedResourceOrganization() {
        AuthApplicationService service = new AuthApplicationService();
        OrganizationService organizationService = mock(OrganizationService.class);
        ReflectionTestUtils.setField(service, "organizationService", organizationService);
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(2L);
        UsersOrganization organizationAdministrator = new UsersOrganization();
        organizationAdministrator.setUserType(UserType.ORG_MAN);
        loginInfo.setUsersOrganizations(List.of(organizationAdministrator));
        CurrentUserHolder.setLoginInfo(loginInfo);
        SsResource resource = new SsResource();
        resource.setCreateBy(1L);
        resource.setManOrgId(100L);
        when(organizationService.isOrganizationManManager(100L)).thenReturn(true);

        assertThat(service.hasResourceManagePermission(resource)).isTrue();
    }

    @Test
    void hasResourceManagePermission_doesNotGloballyAllowOrganizationAdminOutsideManagedOrganization() {
        AuthApplicationService service = new AuthApplicationService();
        OrganizationService organizationService = mock(OrganizationService.class);
        PrivilegeGrantService privilegeGrantService = mock(PrivilegeGrantService.class);
        PositionService positionService = mock(PositionService.class);
        StationService stationService = mock(StationService.class);
        ReflectionTestUtils.setField(service, "organizationService", organizationService);
        ReflectionTestUtils.setField(service, "privilegeGrantService", privilegeGrantService);
        ReflectionTestUtils.setField(service, "positionService", positionService);
        ReflectionTestUtils.setField(service, "stationService", stationService);
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(2L);
        UsersOrganization organizationAdministrator = new UsersOrganization();
        organizationAdministrator.setUserType(UserType.ORG_MAN);
        loginInfo.setUsersOrganizations(List.of(organizationAdministrator));
        CurrentUserHolder.setLoginInfo(loginInfo);
        SsResource resource = new SsResource();
        resource.setResourceId(500L);
        resource.setResourceBizType(ResourceBizTypeEnum.AGENT.name());
        resource.setCreateBy(1L);
        resource.setManOrgId(100L);
        when(organizationService.isOrganizationManManager(100L)).thenReturn(false);
        when(organizationService.findOrganizationByUserId(2L)).thenReturn(List.of());
        when(privilegeGrantService.findPrivilegeByQo(any())).thenAnswer(invocation -> new ArrayList<>());
        when(positionService.findPositionByUserId(2L)).thenReturn(List.of());
        when(stationService.getStationByUserId(2L)).thenReturn(null);

        assertThat(service.hasResourceManagePermission(resource)).isFalse();
    }

    /**
     * 个人助理不对外开放管理授权、使用申请和申请审核；即使当前用户具备平台管理员能力，也要由资源类型兜底压住。
     */
    @Test
    void queryResourceOperationPermissions_rejectsPersonalAssistantAuthAndApplyActions() {
        AuthApplicationService service = new AuthApplicationService();
        SsResourceService ssResourceService = mock(SsResourceService.class);
        ReflectionTestUtils.setField(service, "ssResourceService", ssResourceService);
        mockEmptyUsePermissionDependencies(service);

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(2L);
        UsersOrganization platformManager = new UsersOrganization();
        platformManager.setUserType(UserType.PLAT_MAN);
        loginInfo.setUsersOrganizations(List.of(platformManager));
        CurrentUserHolder.setLoginInfo(loginInfo);

        SsResource personalAssistant = new SsResource();
        personalAssistant.setResourceId(200L);
        personalAssistant.setResourceBizType(ResourceBizTypeEnum.DIG_EMPLOYEE.name());
        personalAssistant.setOwnerType(OwnerType.PERSONAL);
        personalAssistant.setCreateBy(1L);
        personalAssistant.setPublishPortal(1);
        when(ssResourceService.findById(200L)).thenReturn(personalAssistant);

        ResourceOperationPermissionsVo vo = service.queryResourceOperationPermissions(200L);

        assertThat(vo.getCanManageAuth()).isFalse();
        assertThat(vo.getCanAuditUse()).isFalse();
        assertThat(vo.getCanApplyUse()).isFalse();
    }

    /**
     * 默认超级助手允许当前用户编辑，但仍禁止删除登录初始化的底座资源。
     */
    @Test
    void queryResourceOperationPermissions_allowsDefaultSuperAssistantEditButRejectsDelete() {
        AuthApplicationService service = new AuthApplicationService();
        SsResourceService ssResourceService = mock(SsResourceService.class);
        ReflectionTestUtils.setField(service, "ssResourceService", ssResourceService);
        mockEmptyUsePermissionDependencies(service);

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(2L);
        loginInfo.setDefaultDigEmployeeId(205L);
        CurrentUserHolder.setLoginInfo(loginInfo);

        SsResource defaultSuperAssistant = new SsResource();
        defaultSuperAssistant.setResourceId(205L);
        defaultSuperAssistant.setResourceBizType(ResourceBizTypeEnum.DIG_EMPLOYEE.name());
        defaultSuperAssistant.setOwnerType(OwnerType.PERSONAL_DEFAULT);
        defaultSuperAssistant.setResourceCode("user001_main");
        defaultSuperAssistant.setCreateBy(2L);
        defaultSuperAssistant.setPublishPortal(1);
        when(ssResourceService.findById(205L)).thenReturn(defaultSuperAssistant);

        ResourceOperationPermissionsVo vo = service.queryResourceOperationPermissions(205L);

        assertThat(vo.getCanEdit()).isTrue();
        assertThat(vo.getCanDelete()).isFalse();
    }

    /**
     * 个人 tab 下知识/工具/对象/视图只允许有管理权限的人主动授权，不开放使用申请和申请审核。
     */
    @Test
    void queryResourceOperationPermissions_rejectsPersonalNonAssistantApplyAndAuditActions() {
        AuthApplicationService service = new AuthApplicationService();
        SsResourceService ssResourceService = mock(SsResourceService.class);
        ReflectionTestUtils.setField(service, "ssResourceService", ssResourceService);
        mockEmptyUsePermissionDependencies(service);

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(2L);
        UsersOrganization platformManager = new UsersOrganization();
        platformManager.setUserType(UserType.PLAT_MAN);
        loginInfo.setUsersOrganizations(List.of(platformManager));
        CurrentUserHolder.setLoginInfo(loginInfo);

        SsResource personalKnowledge = new SsResource();
        personalKnowledge.setResourceId(201L);
        personalKnowledge.setResourceBizType(ResourceBizTypeEnum.KG_DOC.name());
        personalKnowledge.setOwnerType(OwnerType.PERSONAL);
        personalKnowledge.setCreateBy(1L);
        personalKnowledge.setPublishPortal(1);
        when(ssResourceService.findById(201L)).thenReturn(personalKnowledge);

        ResourceOperationPermissionsVo vo = service.queryResourceOperationPermissions(201L);

        assertThat(vo.getCanManageAuth()).isTrue();
        assertThat(vo.getCanUseAuth()).isTrue();
        assertThat(vo.getCanAuditUse()).isFalse();
        assertThat(vo.getCanApplyUse()).isFalse();
    }

    /**
     * WHALE_AGENT 模式下知识/工具由外部智能体发布，本系统不允许编辑基础信息或注销。
     */
    @Test
    void queryResourceOperationPermissions_rejectsWhaleAgentKnowledgeAndToolEditDeleteActions() {
        AuthApplicationService service = new AuthApplicationService();
        SsResourceService ssResourceService = mock(SsResourceService.class);
        ReflectionTestUtils.setField(service, "ssResourceService", ssResourceService);
        ReflectionTestUtils.setField(service, "privilegeGrantMapper", mock(PrivilegeGrantMapper.class));
        ReflectionTestUtils.setField(service, "datasetSystem", "WHALE_AGENT");

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(2L);
        CurrentUserHolder.setLoginInfo(loginInfo);

        SsResource enterpriseTool = new SsResource();
        enterpriseTool.setResourceId(202L);
        enterpriseTool.setResourceBizType(ResourceBizTypeEnum.TOOLKIT.name());
        enterpriseTool.setOwnerType(OwnerType.ENTERPRISE);
        enterpriseTool.setCreateBy(2L);
        enterpriseTool.setPublishPortal(1);
        when(ssResourceService.findById(202L)).thenReturn(enterpriseTool);

        ResourceOperationPermissionsVo vo = service.queryResourceOperationPermissions(202L);

        assertThat(vo.getCanEdit()).isFalse();
        assertThat(vo.getCanDelete()).isFalse();
        assertThat(vo.getCanManageAuth()).isTrue();
        assertThat(vo.getCanUseAuth()).isTrue();
    }

    /**
     * 个人助理管理授权也要后端兜底禁止，不能只依赖前端隐藏按钮。
     */
    @Test
    void setResourceManagers_rejectsPersonalAssistantResource() {
        mockI18n();
        AuthApplicationService service = new AuthApplicationService();
        SsResourceMapper ssResourceMapper = mock(SsResourceMapper.class);
        ReflectionTestUtils.setField(service, "ssResourceMapper", ssResourceMapper);

        SsResource personalAssistant = new SsResource();
        personalAssistant.setResourceId(203L);
        personalAssistant.setResourceBizType(ResourceBizTypeEnum.DIG_EMPLOYEE.name());
        personalAssistant.setOwnerType(OwnerType.PERSONAL);
        when(ssResourceMapper.selectById(203L)).thenReturn(personalAssistant);

        ResourceMemberSettingQo qo = new ResourceMemberSettingQo();
        qo.setResourceId(203L);

        assertThatThrownBy(() -> service.setResourceManagers(qo)).isInstanceOf(BaseException.class);
    }

    /**
     * 个人 tab 下非助理资源不允许发起使用申请，只能由有管理权限的人主动授权。
     */
    @Test
    void applyUse_rejectsPersonalNonAssistantResource() {
        mockI18n();
        AuthApplicationService service = new AuthApplicationService();
        SsResourceMapper ssResourceMapper = mock(SsResourceMapper.class);
        ReflectionTestUtils.setField(service, "ssResourceMapper", ssResourceMapper);

        SsResource personalObject = new SsResource();
        personalObject.setResourceId(204L);
        personalObject.setResourceBizType(ResourceBizTypeEnum.OBJECT.name());
        personalObject.setOwnerType(OwnerType.PERSONAL);
        when(ssResourceMapper.selectById(204L)).thenReturn(personalObject);

        ResourceUseApplyQo qo = new ResourceUseApplyQo();
        qo.setResourceId(204L);

        assertThatThrownBy(() -> service.applyUse(qo)).isInstanceOf(BaseException.class);
    }

    /**
     * 企业 tab 下直接做“使用授权”时，后端要自动把同资源、同用户的待审核申请抵消掉。
     * 这里覆盖对象、视图、知识、数字员工四类资源，确保逻辑不只对工具生效。
     */
    @ParameterizedTest
    @EnumSource(value = ResourceBizTypeEnum.class, names = { "OBJECT", "VIEW", "KG_DOC", "DIG_EMPLOYEE" })
    void setResourceUsers_autoCancelsPendingApplyForGrantedUsersAcrossSupportedBizTypes(
        ResourceBizTypeEnum resourceBizTypeEnum) {
        AuthApplicationService service = spy(new AuthApplicationService());
        SsResourceMapper ssResourceMapper = mock(SsResourceMapper.class);
        PrivilegeGrantMapper privilegeGrantMapper = mock(PrivilegeGrantMapper.class);
        ReflectionTestUtils.setField(service, "ssResourceMapper", ssResourceMapper);
        ReflectionTestUtils.setField(service, "privilegeGrantMapper", privilegeGrantMapper);
        doNothing().when(service).handleAuth(any(AuthRedBlackDTO.class));

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(2L);
        UsersOrganization platformManager = new UsersOrganization();
        platformManager.setUserType(UserType.PLAT_MAN);
        loginInfo.setUsersOrganizations(List.of(platformManager));
        CurrentUserHolder.setLoginInfo(loginInfo);

        SsResource resource = new SsResource();
        resource.setResourceId(300L);
        resource.setResourceBizType(resourceBizTypeEnum.name());
        resource.setOwnerType(OwnerType.ENTERPRISE);
        resource.setCreateBy(2L);
        when(ssResourceMapper.selectById(300L)).thenReturn(resource);

        AuthDTO userAuth = new AuthDTO();
        userAuth.setGrantToObjType(GrantToObjType.USER);
        userAuth.setGrantToObjId(1001L);

        ResourceMemberSettingQo qo = new ResourceMemberSettingQo();
        qo.setResourceId(300L);
        qo.setRedList(List.of(userAuth));

        service.setResourceUsers(qo);

        verify(privilegeGrantMapper).update(any(PrivilegeGrant.class), any(LambdaUpdateWrapper.class));
    }

    /**
     * 历史/初始化资源可能只有 create_by，没有显式 ALLOW_MANAGE 授权记录。
     * 查询资源成员时仍要把创建人展示为管理人员，避免详情页管理人员为空。
     */
    @Test
    void queryResourceMembers_includesCreatorAsImplicitManagerAndUser() {
        AuthApplicationService service = new AuthApplicationService();
        SsResourceMapper ssResourceMapper = mock(SsResourceMapper.class);
        PrivilegeGrantService privilegeGrantService = mock(PrivilegeGrantService.class);
        UsersMapper usersMapper = mock(UsersMapper.class);
        ReflectionTestUtils.setField(service, "ssResourceMapper", ssResourceMapper);
        ReflectionTestUtils.setField(service, "privilegeGrantService", privilegeGrantService);
        ReflectionTestUtils.setField(service, "usersMapper", usersMapper);

        SsResource resource = new SsResource();
        resource.setResourceId(400L);
        resource.setResourceBizType(ResourceBizTypeEnum.SKILL.name());
        resource.setCreateBy(10001L);
        when(ssResourceMapper.selectById(400L)).thenReturn(resource);
        when(privilegeGrantService.queryResourceMembers(eq(400L), eq(ResourceBizTypeEnum.SKILL.name()), any()))
            .thenReturn(List.of());

        Users creator = new Users();
        creator.setUserId(10001L);
        creator.setUserName("平台管理员");
        when(usersMapper.selectById(10001L)).thenReturn(creator);

        ResourceMemberQueryQo qo = new ResourceMemberQueryQo();
        qo.setResourceId(400L);

        ResourceMemberQueryResultVo result = service.queryResourceMembers(qo);

        assertThat(result.getManagerList()).hasSize(1);
        ResourceMemberItemVo manager = result.getManagerList().get(0);
        assertThat(manager.getGrantToObjType()).isEqualTo(GrantToObjType.USER);
        assertThat(manager.getGrantToObjId()).isEqualTo(10001L);
        assertThat(manager.getGrantToObjName()).isEqualTo("平台管理员");
        assertThat(manager.getGrantType()).isEqualTo(GrantType.ALLOW_MANAGE);
        assertThat(manager.getGrantToType()).isEqualTo(Color.RED);

        assertThat(result.getUseList()).hasSize(1);
        ResourceMemberItemVo user = result.getUseList().get(0);
        assertThat(user.getGrantToObjType()).isEqualTo(GrantToObjType.USER);
        assertThat(user.getGrantToObjId()).isEqualTo(10001L);
        assertThat(user.getGrantToObjName()).isEqualTo("平台管理员");
        assertThat(user.getGrantType()).isEqualTo(GrantType.FORCE_USE);
        assertThat(user.getGrantToType()).isEqualTo(Color.RED);
    }

    /**
     * 重复导入同一编码资源时，创建人默认授权需要按同资源、同用户维度幂等，避免重复写授权关系。
     */
    @Test
    void ensureCreatorDefaultPrivileges_skipsExistingCreatorSameDimensionGrants() {
        AuthApplicationService service = spy(new AuthApplicationService());
        PrivilegeGrantMapper privilegeGrantMapper = mock(PrivilegeGrantMapper.class);
        ReflectionTestUtils.setField(service, "privilegeGrantMapper", privilegeGrantMapper);
        doNothing().when(service).handleAuth(any(AuthRedBlackDTO.class));
        when(privilegeGrantMapper.selectCount(any())).thenReturn(1L);

        SsResource resource = new SsResource();
        resource.setResourceId(300L);
        resource.setResourceBizType(ResourceBizTypeEnum.TOOLKIT.name());
        resource.setOwnerType(OwnerType.PERSONAL);
        resource.setCreateBy(1001L);

        service.ensureCreatorDefaultPrivileges(resource);

        verify(service, never()).handleAuth(any(AuthRedBlackDTO.class));
    }

    /**
     * 个人助理不支持管理授权，创建时只补创建人的 FORCE_USE，避免保存流程反向触发 ALLOW_MANAGE 拦截。
     */
    @Test
    void ensureCreatorDefaultPrivileges_skipsManageGrantForPersonalAssistant() {
        AuthApplicationService service = spy(new AuthApplicationService());
        PrivilegeGrantMapper privilegeGrantMapper = mock(PrivilegeGrantMapper.class);
        ReflectionTestUtils.setField(service, "privilegeGrantMapper", privilegeGrantMapper);
        doNothing().when(service).handleAuth(any(AuthRedBlackDTO.class));
        when(privilegeGrantMapper.selectCount(any())).thenReturn(0L);

        SsResource resource = new SsResource();
        resource.setResourceId(301L);
        resource.setResourceBizType(ResourceBizTypeEnum.DIG_EMPLOYEE.name());
        resource.setOwnerType(OwnerType.PERSONAL);
        resource.setCreateBy(1001L);

        service.ensureCreatorDefaultPrivileges(resource);

        verify(service, never()).handleAuth(argThat(dto -> dto != null
            && GrantType.ALLOW_MANAGE.equals(dto.getGrantType())));
        verify(service).handleAuth(argThat(dto -> dto != null
            && GrantType.FORCE_USE.equals(dto.getGrantType())));
    }

    /**
     * 个人助理管理授权走专门提示，避免继续误报“非平台管理员或组织管理员”。
     */
    @Test
    void handleAuth_rejectsManageGrantForPersonalAssistantWithSpecificMessage() {
        mockI18n();
        AuthApplicationService service = new AuthApplicationService();
        SsResourceMapper ssResourceMapper = mock(SsResourceMapper.class);
        ReflectionTestUtils.setField(service, "ssResourceMapper", ssResourceMapper);

        SsResource resource = new SsResource();
        resource.setResourceId(302L);
        resource.setResourceBizType(ResourceBizTypeEnum.DIG_EMPLOYEE.name());
        resource.setOwnerType(OwnerType.PERSONAL);
        when(ssResourceMapper.selectById(302L)).thenReturn(resource);

        AuthRedBlackDTO dto = new AuthRedBlackDTO();
        dto.setGrantObjId(302L);
        dto.setGrantObjType(ResourceBizTypeEnum.DIG_EMPLOYEE.name());
        dto.setGrantType(GrantType.ALLOW_MANAGE);
        dto.setRedList(List.of());

        assertThatThrownBy(() -> service.handleAuth(dto))
            .isInstanceOf(BaseException.class)
            .hasMessageContaining("auth.personal.assistant.manage.auth.not.allowed");
    }

    /**
     * 给 USER/ORG/POST/STATION 授予管理权限时，要自动补齐同维度 FORCE_USE，确保“可管理即至少可使用”。
     */
    @ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {
        GrantToObjType.USER, GrantToObjType.ORG, GrantToObjType.POST, GrantToObjType.STATION
    })
    void handleAuth_autoAddsForceUseWhenAllowManageGranted(String grantToObjType) {
        mockRedisSetWrite();
        AuthApplicationService service = new AuthApplicationService();
        PrivilegeGrantService privilegeGrantService = mock(PrivilegeGrantService.class);
        PrivilegeGrantMapper privilegeGrantMapper = mock(PrivilegeGrantMapper.class);
        SsResourceMapper ssResourceMapper = mock(SsResourceMapper.class);
        ReflectionTestUtils.setField(service, "privilegeGrantService", privilegeGrantService);
        ReflectionTestUtils.setField(service, "privilegeGrantMapper", privilegeGrantMapper);
        ReflectionTestUtils.setField(service, "ssResourceMapper", ssResourceMapper);
        when(privilegeGrantService.save(any())).thenReturn(true);

        SsResource resource = new SsResource();
        resource.setResourceId(601L);
        resource.setResourceBizType(ResourceBizTypeEnum.KG_DOC.name());
        resource.setOwnerType(OwnerType.ENTERPRISE);
        when(ssResourceMapper.selectById(601L)).thenReturn(resource);
        when(privilegeGrantService.findPrivilegeGrant(anyString(), eq(ResourceBizTypeEnum.KG_DOC.name()), eq(601L), anyString()))
            .thenReturn(List.of());
        when(privilegeGrantMapper.selectCount(any())).thenReturn(0L);

        AuthDTO authDTO = new AuthDTO();
        authDTO.setGrantToObjType(grantToObjType);
        authDTO.setGrantToObjId(1001L);
        AuthRedBlackDTO dto = new AuthRedBlackDTO();
        dto.setGrantType(GrantType.ALLOW_MANAGE);
        dto.setGrantObjType(ResourceBizTypeEnum.KG_DOC.name());
        dto.setGrantObjId(601L);
        dto.setRedList(List.of(authDTO));

        service.handleAuth(dto);

        verify(privilegeGrantService).save(argThat(privilegeGrant -> privilegeGrant != null
            && GrantType.FORCE_USE.equals(privilegeGrant.getGrantType())
            && grantToObjType.equals(privilegeGrant.getGrantToObjType())
            && Long.valueOf(1001L).equals(privilegeGrant.getGrantToObjId())));
    }

    /**
     * 同维度存在使用黑名单时，授予管理权限不能自动覆盖“禁止使用”的显式配置。
     */
    @Test
    void handleAuth_doesNotAutoAddForceUseWhenUseBlackExists() {
        AuthApplicationService service = new AuthApplicationService();
        PrivilegeGrantService privilegeGrantService = mock(PrivilegeGrantService.class);
        PrivilegeGrantMapper privilegeGrantMapper = mock(PrivilegeGrantMapper.class);
        SsResourceMapper ssResourceMapper = mock(SsResourceMapper.class);
        ReflectionTestUtils.setField(service, "privilegeGrantService", privilegeGrantService);
        ReflectionTestUtils.setField(service, "privilegeGrantMapper", privilegeGrantMapper);
        ReflectionTestUtils.setField(service, "ssResourceMapper", ssResourceMapper);

        SsResource resource = new SsResource();
        resource.setResourceId(602L);
        resource.setResourceBizType(ResourceBizTypeEnum.TOOLKIT.name());
        resource.setOwnerType(OwnerType.ENTERPRISE);
        when(ssResourceMapper.selectById(602L)).thenReturn(resource);
        when(privilegeGrantService.findPrivilegeGrant(anyString(), eq(ResourceBizTypeEnum.TOOLKIT.name()), eq(602L), anyString()))
            .thenReturn(List.of());
        when(privilegeGrantMapper.selectCount(any())).thenReturn(1L);

        AuthDTO authDTO = new AuthDTO();
        authDTO.setGrantToObjType(GrantToObjType.USER);
        authDTO.setGrantToObjId(1002L);
        AuthRedBlackDTO dto = new AuthRedBlackDTO();
        dto.setGrantType(GrantType.ALLOW_MANAGE);
        dto.setGrantObjType(ResourceBizTypeEnum.TOOLKIT.name());
        dto.setGrantObjId(602L);
        dto.setRedList(List.of(authDTO));

        service.handleAuth(dto);

        verify(privilegeGrantService, never()).save(argThat(privilegeGrant -> privilegeGrant != null
            && GrantType.FORCE_USE.equals(privilegeGrant.getGrantType())));
    }

    @Test
    void handleAuth_skipsDuplicateUseGrantOnSameUserDimension() {
        AuthApplicationService service = new AuthApplicationService();
        PrivilegeGrantService privilegeGrantService = mock(PrivilegeGrantService.class);
        PrivilegeGrantMapper privilegeGrantMapper = mock(PrivilegeGrantMapper.class);
        ReflectionTestUtils.setField(service, "privilegeGrantService", privilegeGrantService);
        ReflectionTestUtils.setField(service, "privilegeGrantMapper", privilegeGrantMapper);

        AuthDTO userAuth = new AuthDTO();
        userAuth.setGrantToObjType(GrantToObjType.USER);
        userAuth.setGrantToObjId(1001L);

        AuthRedBlackDTO dto = new AuthRedBlackDTO();
        dto.setGrantType(GrantType.FORCE_USE);
        dto.setGrantObjType(ResourceBizTypeEnum.AGENT.name());
        dto.setGrantObjId(88L);
        dto.setRedList(List.of(userAuth));

        when(privilegeGrantService.findPrivilegeGrant(GrantType.FORCE_USE, ResourceBizTypeEnum.AGENT.name(), 88L, Color.RED))
            .thenReturn(List.of());
        when(privilegeGrantService.findPrivilegeGrant(GrantType.FORCE_USE, ResourceBizTypeEnum.AGENT.name(), 88L, Color.BLACK))
            .thenReturn(List.of());
        when(privilegeGrantMapper.selectCount(any())).thenReturn(1L);

        service.handleAuth(dto);

        verify(privilegeGrantService, never()).save(any(PrivilegeGrant.class));
    }

    @Test
    void handleAuth_syncsRequestedUserAuthToRedisWhenDuplicateUseGrantSkipped() {
        AuthApplicationService service = new AuthApplicationService();
        PrivilegeGrantService privilegeGrantService = mock(PrivilegeGrantService.class);
        PrivilegeGrantMapper privilegeGrantMapper = mock(PrivilegeGrantMapper.class);
        AuthRedisSyncService authRedisSyncService = mock(AuthRedisSyncService.class);
        ReflectionTestUtils.setField(service, "privilegeGrantService", privilegeGrantService);
        ReflectionTestUtils.setField(service, "privilegeGrantMapper", privilegeGrantMapper);
        ReflectionTestUtils.setField(service, "authRedisSyncService", authRedisSyncService);

        AuthDTO userAuth = new AuthDTO();
        userAuth.setGrantToObjType(GrantToObjType.USER);
        userAuth.setGrantToObjId(1001L);

        AuthRedBlackDTO dto = new AuthRedBlackDTO();
        dto.setGrantType(GrantType.FORCE_USE);
        dto.setGrantObjType(ResourceBizTypeEnum.AGENT.name());
        dto.setGrantObjId(88L);
        dto.setRedList(List.of(userAuth));

        when(privilegeGrantService.findPrivilegeGrant(GrantType.FORCE_USE, ResourceBizTypeEnum.AGENT.name(), 88L,
            Color.RED)).thenReturn(List.of());
        when(privilegeGrantService.findPrivilegeGrant(GrantType.FORCE_USE, ResourceBizTypeEnum.AGENT.name(), 88L,
            Color.BLACK)).thenReturn(List.of());
        when(privilegeGrantMapper.selectCount(any())).thenReturn(1L);

        service.handleAuth(dto);

        verify(privilegeGrantService, never()).save(any(PrivilegeGrant.class));
        verify(authRedisSyncService).asyncSyncAuthChangedUsers(argThat(userIds -> userIds.contains(1001L)),
            eq(GrantType.FORCE_USE));
    }

    @Test
    void handleAuth_allowsInsertWhenPermissionExistsOnDifferentDimension() {
        AuthApplicationService service = new AuthApplicationService();
        PrivilegeGrantMapper privilegeGrantMapper = mock(PrivilegeGrantMapper.class);
        ReflectionTestUtils.setField(service, "privilegeGrantMapper", privilegeGrantMapper);
        when(privilegeGrantMapper.selectCount(any())).thenReturn(0L);

        PrivilegeGrant privilegeGrant = new PrivilegeGrant();
        privilegeGrant.setGrantType(GrantType.FORCE_USE);
        privilegeGrant.setGrantObjType(ResourceBizTypeEnum.AGENT.name());
        privilegeGrant.setGrantObjId(89L);
        privilegeGrant.setGrantToObjType(GrantToObjType.USER);
        privilegeGrant.setGrantToObjId(1001L);
        privilegeGrant.setGrantToType(Color.RED);
        privilegeGrant.setOperType(OperType.READ);

        boolean skipped = (boolean) ReflectionTestUtils.invokeMethod(service, "shouldSkipSameDimensionDuplicateGrant",
            GrantType.FORCE_USE, privilegeGrant);

        assertThat(skipped).isFalse();
    }

    @Test
    void shouldSkipSameDimensionDuplicateGrant_skipsExistingManageGrant() {
        AuthApplicationService service = new AuthApplicationService();
        PrivilegeGrantMapper privilegeGrantMapper = mock(PrivilegeGrantMapper.class);
        ReflectionTestUtils.setField(service, "privilegeGrantMapper", privilegeGrantMapper);
        when(privilegeGrantMapper.selectCount(any())).thenReturn(1L);

        PrivilegeGrant privilegeGrant = new PrivilegeGrant();
        privilegeGrant.setGrantType(GrantType.ALLOW_MANAGE);
        privilegeGrant.setGrantObjType(ResourceBizTypeEnum.TOOLKIT.name());
        privilegeGrant.setGrantObjId(300L);
        privilegeGrant.setGrantToObjType(GrantToObjType.USER);
        privilegeGrant.setGrantToObjId(1001L);
        privilegeGrant.setGrantToType(Color.RED);
        privilegeGrant.setOperType(OperType.READ);

        boolean skipped = (boolean) ReflectionTestUtils.invokeMethod(service, "shouldSkipSameDimensionDuplicateGrant",
            GrantType.ALLOW_MANAGE, privilegeGrant);

        assertThat(skipped).isTrue();
    }

    @Test
    void listAuthDetail_filtersByGrantObjTypeAndDeduplicatesSameTarget() {
        AuthApplicationService service = new AuthApplicationService();
        PrivilegeGrantMapper privilegeGrantMapper = mock(PrivilegeGrantMapper.class);
        UserService userService = mock(UserService.class);
        OrganizationService organizationService = mock(OrganizationService.class);
        SsResourceService ssResourceService = mock(SsResourceService.class);
        ReflectionTestUtils.setField(service, "privilegeGrantMapper", privilegeGrantMapper);
        ReflectionTestUtils.setField(service, "userService", userService);
        ReflectionTestUtils.setField(service, "organizationService", organizationService);
        ReflectionTestUtils.setField(service, "ssResourceService", ssResourceService);

        Users user = new Users();
        user.setUserId(1001L);
        user.setUserName("tester");
        when(userService.findById(1001L)).thenReturn(user);
        SsResource resource = new SsResource();
        resource.setResourceId(501L);
        resource.setCreateBy(1001L);
        when(ssResourceService.findById(501L)).thenReturn(resource);
        Organization organization = new Organization();
        organization.setOrgId(2001L);
        organization.setOrgName("test-org");
        when(organizationService.findById(2001L)).thenReturn(organization);

        PrivilegeGrant duplicateRed1 = new PrivilegeGrant();
        duplicateRed1.setGrantType(GrantType.ALLOW_MANAGE);
        duplicateRed1.setGrantObjType(ResourceBizTypeEnum.KG_DOC.name());
        duplicateRed1.setGrantObjId(501L);
        duplicateRed1.setGrantToObjType(GrantToObjType.USER);
        duplicateRed1.setGrantToObjId(1001L);
        duplicateRed1.setGrantToType(Color.RED);

        PrivilegeGrant duplicateRed2 = new PrivilegeGrant();
        duplicateRed2.setGrantType(GrantType.ALLOW_MANAGE);
        duplicateRed2.setGrantObjType(ResourceBizTypeEnum.KG_DOC.name());
        duplicateRed2.setGrantObjId(501L);
        duplicateRed2.setGrantToObjType(GrantToObjType.USER);
        duplicateRed2.setGrantToObjId(1001L);
        duplicateRed2.setGrantToType(Color.RED);

        PrivilegeGrant blackGrant = new PrivilegeGrant();
        blackGrant.setGrantType(GrantType.ALLOW_MANAGE);
        blackGrant.setGrantObjType(ResourceBizTypeEnum.KG_DOC.name());
        blackGrant.setGrantObjId(501L);
        blackGrant.setGrantToObjType(GrantToObjType.ORG);
        blackGrant.setGrantToObjId(2001L);
        blackGrant.setGrantToType(Color.BLACK);

        when(privilegeGrantMapper.selectList(any())).thenReturn(List.of(duplicateRed1, duplicateRed2, blackGrant));

        AuthDetailQo qo = new AuthDetailQo();
        qo.setGrantType(GrantType.ALLOW_MANAGE);
        qo.setGrantObjType(ResourceBizTypeEnum.KG_DOC.name());
        qo.setGrantObjId(501L);

        ResponseUtil response = service.listAuthDetail(qo);

        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) response.getData();
        @SuppressWarnings("unchecked")
        List<AuthDTO> redList = (List<AuthDTO>) data.get("redList");
        @SuppressWarnings("unchecked")
        List<AuthDTO> blackList = (List<AuthDTO>) data.get("blackList");

        assertThat(redList).hasSize(1);
        assertThat(redList.get(0).getGrantToObjType()).isEqualTo(GrantToObjType.USER);
        assertThat(redList.get(0).getGrantToObjId()).isEqualTo(1001L);
        assertThat(blackList).hasSize(1);
        assertThat(blackList.get(0).getGrantToObjType()).isEqualTo(GrantToObjType.ORG);
        assertThat(blackList.get(0).getGrantToObjId()).isEqualTo(2001L);
    }

    @Test
    void listAuthDetail_appendsCreatorWhenDefaultPrivilegeNotPersisted() {
        AuthApplicationService service = new AuthApplicationService();
        PrivilegeGrantMapper privilegeGrantMapper = mock(PrivilegeGrantMapper.class);
        UserService userService = mock(UserService.class);
        SsResourceService ssResourceService = mock(SsResourceService.class);
        ReflectionTestUtils.setField(service, "privilegeGrantMapper", privilegeGrantMapper);
        ReflectionTestUtils.setField(service, "userService", userService);
        ReflectionTestUtils.setField(service, "ssResourceService", ssResourceService);

        Users user = new Users();
        user.setUserId(1001L);
        user.setUserName("creator");
        when(userService.findById(1001L)).thenReturn(user);
        SsResource resource = new SsResource();
        resource.setResourceId(501L);
        resource.setCreateBy(1001L);
        when(ssResourceService.findById(501L)).thenReturn(resource);
        when(privilegeGrantMapper.selectList(any())).thenReturn(List.of());

        AuthDetailQo qo = new AuthDetailQo();
        qo.setGrantType(GrantType.FORCE_USE);
        qo.setGrantObjType(ResourceBizTypeEnum.ONTOLOGY_BASE.name());
        qo.setGrantObjId(501L);

        ResponseUtil response = service.listAuthDetail(qo);

        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) response.getData();
        @SuppressWarnings("unchecked")
        List<AuthDTO> redList = (List<AuthDTO>) data.get("redList");

        assertThat(redList).hasSize(1);
        assertThat(redList.get(0).getGrantToObjType()).isEqualTo(GrantToObjType.USER);
        assertThat(redList.get(0).getGrantToObjId()).isEqualTo(1001L);
        assertThat(redList.get(0).getGrantToObjName()).isEqualTo("creator");
    }

    @Test
    void approveUseApply_skipsForceUseInsertWhenSameUserDimensionAlreadyHasUsePermission() {
        AuthApplicationService service = new AuthApplicationService();
        SsResourceMapper ssResourceMapper = mock(SsResourceMapper.class);
        PrivilegeGrantMapper privilegeGrantMapper = mock(PrivilegeGrantMapper.class);
        PrivilegeGrantService privilegeGrantService = mock(PrivilegeGrantService.class);
        ReflectionTestUtils.setField(service, "ssResourceMapper", ssResourceMapper);
        ReflectionTestUtils.setField(service, "privilegeGrantMapper", privilegeGrantMapper);
        ReflectionTestUtils.setField(service, "privilegeGrantService", privilegeGrantService);

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(2L);
        UsersOrganization platformManager = new UsersOrganization();
        platformManager.setUserType(UserType.PLAT_MAN);
        loginInfo.setUsersOrganizations(List.of(platformManager));
        CurrentUserHolder.setLoginInfo(loginInfo);

        SsResource resource = new SsResource();
        resource.setResourceId(300L);
        resource.setResourceBizType(ResourceBizTypeEnum.AGENT.name());
        resource.setCreateBy(1L);
        when(ssResourceMapper.selectById(300L)).thenReturn(resource);

        PrivilegeGrant pendingApply = new PrivilegeGrant();
        pendingApply.setPrivilegeGrantId(500L);
        pendingApply.setGrantType(GrantType.AVAILABLE_USE);
        pendingApply.setGrantObjType(ResourceBizTypeEnum.AGENT.name());
        pendingApply.setGrantObjId(300L);
        pendingApply.setGrantToObjType(GrantToObjType.USER);
        pendingApply.setGrantToObjId(1001L);
        pendingApply.setGrantToType(Color.RED);
        pendingApply.setOperType(OperType.READ);
        pendingApply.setStatusCd("P");
        when(privilegeGrantMapper.selectOne(any())).thenReturn(pendingApply);
        when(privilegeGrantMapper.selectCount(any())).thenReturn(1L);

        ResourceUseApplyApproveQo qo = new ResourceUseApplyApproveQo();
        qo.setResourceId(300L);
        qo.setApplyUserId(1001L);

        service.approveUseApply(qo);

        verify(privilegeGrantService, never()).save(any(PrivilegeGrant.class));
        verify(privilegeGrantService).update(eq(pendingApply));
    }

    @Test
    void queryResourceOperationPermissions_exposesPendingUseApplication() {
        AuthApplicationService service = new AuthApplicationService();
        SsResourceService ssResourceService = mock(SsResourceService.class);
        PrivilegeGrantMapper privilegeGrantMapper = mock(PrivilegeGrantMapper.class);
        ReflectionTestUtils.setField(service, "ssResourceService", ssResourceService);
        ReflectionTestUtils.setField(service, "privilegeGrantMapper", privilegeGrantMapper);
        mockEmptyUsePermissionDependencies(service);
        LoginInfo loginInfo = loginInfo(2L);
        CurrentUserHolder.setLoginInfo(loginInfo);
        SsResource resource = enterpriseResource(600L, 1L);
        when(ssResourceService.findById(600L)).thenReturn(resource);
        PrivilegeGrant pending = useGrant(600L, 2L, GrantToObjType.USER, Color.RED, "P");
        when(privilegeGrantMapper.selectList(any())).thenReturn(List.of(pending));

        ResourceOperationPermissionsVo result = service.queryResourceOperationPermissions(600L);

        assertThat(result.getUseApplyPending()).isTrue();
        assertThat(result.getCanApplyUse()).isFalse();
        assertThat(result.getHasUsePermission()).isFalse();
    }

    @Test
    void queryResourceOperationPermissionsBatch_exposesPendingAndUnavailableWithoutPerResourcePendingQueries() {
        AuthApplicationService service = new AuthApplicationService();
        SsResourceMapper ssResourceMapper = mock(SsResourceMapper.class);
        PrivilegeGrantMapper privilegeGrantMapper = mock(PrivilegeGrantMapper.class);
        ReflectionTestUtils.setField(service, "ssResourceMapper", ssResourceMapper);
        ReflectionTestUtils.setField(service, "privilegeGrantMapper", privilegeGrantMapper);
        mockEmptyUsePermissionDependencies(service);
        CurrentUserHolder.setLoginInfo(loginInfo(2L));
        SsResource pendingResource = enterpriseResource(601L, 1L);
        SsResource unavailableResource = enterpriseResource(602L, 1L);
        unavailableResource.setPublishPortal(0);
        when(ssResourceMapper.selectBatchIds(any())).thenReturn(List.of(pendingResource, unavailableResource));
        when(privilegeGrantMapper.selectList(any())).thenReturn(
            List.of(useGrant(601L, 2L, GrantToObjType.USER, Color.RED, "P")));

        Map<Long, ResourceOperationPermissionsVo> result =
            service.queryResourceOperationPermissionsBatch(List.of(601L, 602L));

        assertThat(result.get(601L).getUseApplyPending()).isTrue();
        assertThat(result.get(601L).getCanApplyUse()).isFalse();
        assertThat(result.get(602L).getUseApplyPending()).isFalse();
        assertThat(result.get(602L).getCanApplyUse()).isFalse();
        verify(privilegeGrantMapper, times(1)).selectList(any());
    }

    @Test
    void applyUseIfNeeded_returnsPendingWithoutMutation() {
        AuthApplicationService service = spy(new AuthApplicationService());
        SsResourceMapper ssResourceMapper = mock(SsResourceMapper.class);
        PrivilegeGrantMapper privilegeGrantMapper = mock(PrivilegeGrantMapper.class);
        PrivilegeGrantService privilegeGrantService = mock(PrivilegeGrantService.class);
        ReflectionTestUtils.setField(service, "ssResourceMapper", ssResourceMapper);
        ReflectionTestUtils.setField(service, "privilegeGrantMapper", privilegeGrantMapper);
        ReflectionTestUtils.setField(service, "privilegeGrantService", privilegeGrantService);
        CurrentUserHolder.setLoginInfo(loginInfo(2L));
        SsResource resource = enterpriseResource(603L, 1L);
        when(ssResourceMapper.selectOne(any())).thenReturn(resource);
        when(privilegeGrantMapper.selectOne(any())).thenReturn(
            useGrant(603L, 2L, GrantToObjType.USER, Color.RED, "P"));

        assertThat(service.applyUseIfNeeded(603L)).isEqualTo(UseApplyOutcome.PENDING);

        verify(service, never()).applyUse(any());
        verify(privilegeGrantService, never()).save(any());
    }

    @Test
    void applyUseIfNeeded_returnsPendingForPersonalResourceWithoutMutation() {
        AuthApplicationService service = spy(new AuthApplicationService());
        SsResourceMapper ssResourceMapper = mock(SsResourceMapper.class);
        PrivilegeGrantMapper privilegeGrantMapper = mock(PrivilegeGrantMapper.class);
        PrivilegeGrantService privilegeGrantService = mock(PrivilegeGrantService.class);
        ReflectionTestUtils.setField(service, "ssResourceMapper", ssResourceMapper);
        ReflectionTestUtils.setField(service, "privilegeGrantMapper", privilegeGrantMapper);
        ReflectionTestUtils.setField(service, "privilegeGrantService", privilegeGrantService);
        CurrentUserHolder.setLoginInfo(loginInfo(2L));
        SsResource resource = enterpriseResource(610L, 1L);
        resource.setOwnerType(OwnerType.PERSONAL);
        resource.setResourceBizType(ResourceBizTypeEnum.OBJECT.name());
        when(ssResourceMapper.selectOne(any())).thenReturn(resource);
        when(privilegeGrantMapper.selectOne(any())).thenReturn(
            useGrant(610L, 2L, GrantToObjType.USER, Color.RED, "P"));

        assertThat(service.applyUseIfNeeded(610L)).isEqualTo(UseApplyOutcome.PENDING);

        verify(service, never()).applyUse(any());
        verify(privilegeGrantService, never()).save(any());
    }

    @Test
    void applyUseIfNeeded_returnsUnavailableForPersonalResourceWithoutMutation() {
        AuthApplicationService service = spy(new AuthApplicationService());
        SsResourceMapper ssResourceMapper = mock(SsResourceMapper.class);
        PrivilegeGrantMapper privilegeGrantMapper = mock(PrivilegeGrantMapper.class);
        PrivilegeGrantService privilegeGrantService = mock(PrivilegeGrantService.class);
        ReflectionTestUtils.setField(service, "ssResourceMapper", ssResourceMapper);
        ReflectionTestUtils.setField(service, "privilegeGrantMapper", privilegeGrantMapper);
        ReflectionTestUtils.setField(service, "privilegeGrantService", privilegeGrantService);
        CurrentUserHolder.setLoginInfo(loginInfo(2L));
        SsResource resource = enterpriseResource(611L, 1L);
        resource.setOwnerType(OwnerType.PERSONAL);
        resource.setResourceBizType(ResourceBizTypeEnum.OBJECT.name());
        when(ssResourceMapper.selectOne(any())).thenReturn(resource);

        assertThat(service.applyUseIfNeeded(611L)).isEqualTo(UseApplyOutcome.UNAVAILABLE);

        verify(service, never()).applyUse(any());
        verify(privilegeGrantService, never()).save(any());
    }

    @Test
    void applyUseIfNeeded_returnsUnavailableWithoutMutation() {
        AuthApplicationService service = spy(new AuthApplicationService());
        SsResourceMapper ssResourceMapper = mock(SsResourceMapper.class);
        PrivilegeGrantMapper privilegeGrantMapper = mock(PrivilegeGrantMapper.class);
        PrivilegeGrantService privilegeGrantService = mock(PrivilegeGrantService.class);
        ReflectionTestUtils.setField(service, "ssResourceMapper", ssResourceMapper);
        ReflectionTestUtils.setField(service, "privilegeGrantMapper", privilegeGrantMapper);
        ReflectionTestUtils.setField(service, "privilegeGrantService", privilegeGrantService);
        CurrentUserHolder.setLoginInfo(loginInfo(2L));
        SsResource resource = enterpriseResource(604L, 2L);
        when(ssResourceMapper.selectOne(any())).thenReturn(resource);

        assertThat(service.applyUseIfNeeded(604L)).isEqualTo(UseApplyOutcome.UNAVAILABLE);

        verify(service, never()).applyUse(any());
        verify(privilegeGrantService, never()).save(any());
    }

    @Test
    void applyUseIfNeeded_locksBeforePendingCheck() {
        AuthApplicationService service = new AuthApplicationService();
        SsResourceMapper ssResourceMapper = mock(SsResourceMapper.class);
        PrivilegeGrantMapper privilegeGrantMapper = mock(PrivilegeGrantMapper.class);
        PrivilegeGrantService privilegeGrantService = mock(PrivilegeGrantService.class);
        ReflectionTestUtils.setField(service, "ssResourceMapper", ssResourceMapper);
        ReflectionTestUtils.setField(service, "privilegeGrantMapper", privilegeGrantMapper);
        ReflectionTestUtils.setField(service, "privilegeGrantService", privilegeGrantService);
        CurrentUserHolder.setLoginInfo(loginInfo(2L));
        SsResource resource = enterpriseResource(605L, 1L);
        when(ssResourceMapper.selectOne(any())).thenReturn(resource);
        when(privilegeGrantMapper.selectOne(any())).thenReturn(
            useGrant(605L, 2L, GrantToObjType.USER, Color.RED, "P"));

        assertThat(service.applyUseIfNeeded(605L)).isEqualTo(UseApplyOutcome.PENDING);

        ArgumentCaptor<LambdaQueryWrapper<SsResource>> lockCaptor = ArgumentCaptor.forClass(LambdaQueryWrapper.class);
        InOrder order = inOrder(ssResourceMapper, privilegeGrantMapper);
        order.verify(ssResourceMapper).selectOne(lockCaptor.capture());
        order.verify(privilegeGrantMapper).selectOne(any());
        assertThat(String.valueOf(ReflectionTestUtils.getField(lockCaptor.getValue(), "lastSql")))
            .containsIgnoringCase("FOR UPDATE");
        verify(privilegeGrantService, never()).save(any());
    }

    @Test
    void applyUseIfNeeded_createsRealPendingGrantOnceThenReturnsPending() {
        AuthApplicationService service = new AuthApplicationService();
        SsResourceMapper ssResourceMapper = mock(SsResourceMapper.class);
        PrivilegeGrantMapper privilegeGrantMapper = mock(PrivilegeGrantMapper.class);
        ReflectionTestUtils.setField(service, "ssResourceMapper", ssResourceMapper);
        ReflectionTestUtils.setField(service, "privilegeGrantMapper", privilegeGrantMapper);
        mockEmptyUsePermissionDependencies(service);
        PrivilegeGrantService privilegeGrantService =
            (PrivilegeGrantService) ReflectionTestUtils.getField(service, "privilegeGrantService");
        CurrentUserHolder.setLoginInfo(loginInfo(2L));
        SsResource resource = enterpriseResource(612L, 1L);
        when(ssResourceMapper.selectOne(any())).thenReturn(resource);
        when(ssResourceMapper.selectById(612L)).thenReturn(resource);
        PrivilegeGrant pending = useGrant(612L, 2L, GrantToObjType.USER, Color.RED, "P");
        when(privilegeGrantMapper.selectOne(any())).thenReturn(null, pending);

        assertThat(service.applyUseIfNeeded(612L)).isEqualTo(UseApplyOutcome.CREATED);
        assertThat(service.applyUseIfNeeded(612L)).isEqualTo(UseApplyOutcome.PENDING);

        ArgumentCaptor<PrivilegeGrant> grantCaptor = ArgumentCaptor.forClass(PrivilegeGrant.class);
        verify(privilegeGrantService, times(1)).save(grantCaptor.capture());
        PrivilegeGrant saved = grantCaptor.getValue();
        assertThat(saved.getGrantObjId()).isEqualTo(612L);
        assertThat(saved.getGrantObjType()).isEqualTo(ResourceBizTypeEnum.AGENT.name());
        assertThat(saved.getGrantType()).isEqualTo(GrantType.AVAILABLE_USE);
        assertThat(saved.getGrantToObjId()).isEqualTo(2L);
        assertThat(saved.getGrantToObjType()).isEqualTo(GrantToObjType.USER);
        assertThat(saved.getGrantToType()).isEqualTo(Color.RED);
        assertThat(saved.getOperType()).isEqualTo(OperType.READ);
        assertThat(saved.getStatusCd()).isEqualTo("P");
    }

    @Test
    void applyUseIfNeeded_missingLockedResourceThrowsWithoutPendingLookupOrSave() {
        AuthApplicationService service = new AuthApplicationService();
        SsResourceMapper ssResourceMapper = mock(SsResourceMapper.class);
        PrivilegeGrantMapper privilegeGrantMapper = mock(PrivilegeGrantMapper.class);
        PrivilegeGrantService privilegeGrantService = mock(PrivilegeGrantService.class);
        ReflectionTestUtils.setField(service, "ssResourceMapper", ssResourceMapper);
        ReflectionTestUtils.setField(service, "privilegeGrantMapper", privilegeGrantMapper);
        ReflectionTestUtils.setField(service, "privilegeGrantService", privilegeGrantService);
        CurrentUserHolder.setLoginInfo(loginInfo(2L));
        when(ssResourceMapper.selectOne(any())).thenReturn(null);

        assertThatThrownBy(() -> service.applyUseIfNeeded(613L)).isInstanceOf(BaseException.class);

        verify(privilegeGrantMapper, never()).selectOne(any());
        verify(privilegeGrantService, never()).save(any());
    }

    @Test
    void hasResourceUsePermissionForUser_appliesDirectBlackOverDirectRedAndPreservesCurrentUser() {
        AuthApplicationService service = newExplicitUserPermissionService(List.of(
            useGrant(606L, 3L, GrantToObjType.USER, Color.RED, "A"),
            useGrant(606L, 3L, GrantToObjType.USER, Color.BLACK, "A")));
        CurrentUserHolder.setLoginInfo(loginInfo(2L));
        SsResource resource = enterpriseResource(606L, 1L);

        assertThat(service.hasResourceUsePermission(resource, 3L)).isFalse();
        assertThat(CurrentUserHolder.getCurrentUserId()).isEqualTo(2L);
        assertThat(service.hasResourceUsePermission(resource)).isFalse();
    }

    @Test
    void hasResourceUsePermissionForUser_allowsDirectRedAndFailsClosedForInvalidUser() {
        AuthApplicationService service = newExplicitUserPermissionService(
            List.of(useGrant(607L, 3L, GrantToObjType.USER, Color.RED, "A")));
        SsResource resource = enterpriseResource(607L, 1L);

        assertThat(service.hasResourceUsePermission(resource, 3L)).isTrue();
        assertThat(service.hasResourceUsePermission(resource, null)).isFalse();
    }

    @ParameterizedTest
    @EnumSource(value = ExplicitGrantSource.class)
    void hasResourceUsePermissionForUser_allowsInheritedGrant(ExplicitGrantSource source) {
        AuthApplicationService service = newExplicitUserPermissionService(
            List.of(useGrant(608L, source.targetId, source.grantToObjType, Color.RED, "A")));
        configureMembership(service, source);

        assertThat(service.hasResourceUsePermission(enterpriseResource(608L, 1L), 3L)).isTrue();
    }

    @Test
    void hasResourceUsePermissionForUser_deniesUserWithoutGrant() {
        AuthApplicationService service = newExplicitUserPermissionService(List.of());

        assertThat(service.hasResourceUsePermission(enterpriseResource(609L, 1L), 3L)).isFalse();
    }

    @Test
    void hasResourceUsePermissionForUser_skipsInheritedQueriesForEmptyMemberships() {
        AuthApplicationService service = newExplicitUserPermissionService(List.of(
            useGrant(614L, 30L, GrantToObjType.ORG, Color.RED, "A"),
            useGrant(614L, 31L, GrantToObjType.POST, Color.RED, "A"),
            useGrant(614L, 32L, GrantToObjType.STATION, Color.RED, "A")));
        PrivilegeGrantService privilegeGrantService =
            (PrivilegeGrantService) ReflectionTestUtils.getField(service, "privilegeGrantService");

        assertThat(service.hasResourceUsePermission(enterpriseResource(614L, 1L), 3L)).isFalse();
        verify(privilegeGrantService, never()).findPrivilegeByQo(argThat(qo ->
            GrantToObjType.ORG.equals(qo.getGrantToObjType())
                || GrantToObjType.POST.equals(qo.getGrantToObjType())
                || GrantToObjType.STATION.equals(qo.getGrantToObjType())));
    }

    @Test
    void hasResourceUsePermissionForUser_doesNotInheritNonmatchingMembershipGrants() {
        AuthApplicationService service = newExplicitUserPermissionService(List.of(
            useGrant(615L, 999L, GrantToObjType.ORG, Color.RED, "A"),
            useGrant(615L, 998L, GrantToObjType.POST, Color.RED, "A")));
        Organization organization = new Organization();
        organization.setPathCode("30");
        PositionDTO position = new PositionDTO();
        position.setPositionId(31L);
        OrganizationService organizationService =
            (OrganizationService) ReflectionTestUtils.getField(service, "organizationService");
        PositionService positionService = (PositionService) ReflectionTestUtils.getField(service, "positionService");
        PrivilegeGrantService privilegeGrantService =
            (PrivilegeGrantService) ReflectionTestUtils.getField(service, "privilegeGrantService");
        when(organizationService.findOrganizationByUserId(3L)).thenReturn(List.of(organization));
        when(positionService.findPositionByUserId(3L)).thenReturn(List.of(position));

        assertThat(service.hasResourceUsePermission(enterpriseResource(615L, 1L), 3L)).isFalse();

        ArgumentCaptor<PrivilegeGrantQo> qoCaptor = ArgumentCaptor.forClass(PrivilegeGrantQo.class);
        verify(privilegeGrantService, times(3)).findPrivilegeByQo(qoCaptor.capture());
        PrivilegeGrantQo orgQo = qoCaptor.getAllValues().stream()
            .filter(qo -> GrantToObjType.ORG.equals(qo.getGrantToObjType())).findFirst().orElseThrow();
        PrivilegeGrantQo postQo = qoCaptor.getAllValues().stream()
            .filter(qo -> GrantToObjType.POST.equals(qo.getGrantToObjType())).findFirst().orElseThrow();
        assertThat(orgQo.getGrantToObjIds()).containsExactly(30L);
        assertThat(postQo.getGrantToObjIds()).containsExactly(31L);
    }

    private AuthApplicationService newExplicitUserPermissionService(List<PrivilegeGrant> grants) {
        AuthApplicationService service = new AuthApplicationService();
        PrivilegeGrantService privilegeGrantService = mock(PrivilegeGrantService.class);
        OrganizationService organizationService = mock(OrganizationService.class);
        PositionService positionService = mock(PositionService.class);
        StationService stationService = mock(StationService.class);
        ReflectionTestUtils.setField(service, "privilegeGrantService", privilegeGrantService);
        ReflectionTestUtils.setField(service, "organizationService", organizationService);
        ReflectionTestUtils.setField(service, "positionService", positionService);
        ReflectionTestUtils.setField(service, "stationService", stationService);
        when(privilegeGrantService.findPrivilegeByQo(any())).thenAnswer(invocation -> {
            PrivilegeGrantQo qo = invocation.getArgument(0);
            return grants.stream().filter(grant -> grant.getGrantToObjType().equals(qo.getGrantToObjType()))
                .filter(grant -> qo.getGrantToObjId() == null || qo.getGrantToObjId().equals(grant.getGrantToObjId()))
                .filter(grant -> qo.getGrantToObjIds() == null || qo.getGrantToObjIds().isEmpty()
                    || qo.getGrantToObjIds().contains(grant.getGrantToObjId()))
                .collect(java.util.stream.Collectors.toCollection(ArrayList::new));
        });
        when(organizationService.findOrganizationByUserId(any())).thenReturn(List.of());
        when(positionService.findPositionByUserId(any())).thenReturn(List.of());
        when(stationService.getStationByUserId(any())).thenReturn(null);
        return service;
    }

    private void configureMembership(AuthApplicationService service, ExplicitGrantSource source) {
        if (source == ExplicitGrantSource.ORGANIZATION) {
            Organization organization = new Organization();
            organization.setPathCode(String.valueOf(source.targetId));
            OrganizationService organizationService =
                (OrganizationService) ReflectionTestUtils.getField(service, "organizationService");
            when(organizationService.findOrganizationByUserId(3L)).thenReturn(List.of(organization));
        }
        else if (source == ExplicitGrantSource.POST) {
            PositionDTO position = new PositionDTO();
            position.setPositionId(source.targetId);
            PositionService positionService = (PositionService) ReflectionTestUtils.getField(service, "positionService");
            when(positionService.findPositionByUserId(3L)).thenReturn(List.of(position));
        }
        else {
            Station station = new Station();
            station.setStationIdPath(String.valueOf(source.targetId));
            StationService stationService = (StationService) ReflectionTestUtils.getField(service, "stationService");
            when(stationService.getStationByUserId(3L)).thenReturn(station);
        }
    }

    private LoginInfo loginInfo(Long userId) {
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(userId);
        return loginInfo;
    }

    private SsResource enterpriseResource(Long resourceId, Long createBy) {
        SsResource resource = new SsResource();
        resource.setResourceId(resourceId);
        resource.setResourceBizType(ResourceBizTypeEnum.AGENT.name());
        resource.setOwnerType(OwnerType.ENTERPRISE);
        resource.setCreateBy(createBy);
        resource.setPublishPortal(1);
        return resource;
    }

    private PrivilegeGrant useGrant(Long resourceId, Long targetId, String targetType, String color, String status) {
        PrivilegeGrant grant = new PrivilegeGrant();
        grant.setGrantObjId(resourceId);
        grant.setGrantObjType(ResourceBizTypeEnum.AGENT.name());
        grant.setGrantType(GrantType.AVAILABLE_USE);
        grant.setGrantToObjType(targetType);
        grant.setGrantToObjId(targetId);
        grant.setGrantToType(color);
        grant.setOperType(OperType.READ);
        grant.setStatusCd(status);
        return grant;
    }

    private enum ExplicitGrantSource {
        ORGANIZATION(GrantToObjType.ORG, 30L),
        POST(GrantToObjType.POST, 31L),
        STATION(GrantToObjType.STATION, 32L);

        private final String grantToObjType;
        private final Long targetId;

        ExplicitGrantSource(String grantToObjType, Long targetId) {
            this.grantToObjType = grantToObjType;
            this.targetId = targetId;
        }
    }
}
