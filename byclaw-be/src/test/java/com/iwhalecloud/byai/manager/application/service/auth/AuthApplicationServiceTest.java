package com.iwhalecloud.byai.manager.application.service.auth;

import com.iwhalecloud.byai.common.constants.resource.OwnerType;
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
import com.iwhalecloud.byai.manager.domain.auth.service.PrivilegeGrantService;
import com.iwhalecloud.byai.manager.domain.organization.service.OrganizationService;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceBizTypeEnum;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.dto.auth.AuthDTO;
import com.iwhalecloud.byai.manager.dto.auth.AuthRedBlackDTO;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.entity.organization.Organization;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.auth.PrivilegeGrantMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.manager.qo.auth.AuthDetailQo;
import com.iwhalecloud.byai.manager.qo.auth.ResourceUseApplyApproveQo;
import com.iwhalecloud.byai.manager.qo.auth.ResourceUseApplyQo;
import com.iwhalecloud.byai.manager.qo.auth.ResourceMemberSettingQo;
import com.iwhalecloud.byai.manager.vo.auth.ResourceOperationPermissionsVo;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.context.MessageSource;
import org.springframework.data.redis.core.SetOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.util.ReflectionTestUtils;

import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;

import java.util.List;
import java.util.Locale;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AuthApplicationServiceTest {

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

    /**
     * 默认超级助手禁止被设置使用授权，后端需要兜底拦截，不能只依赖前端隐藏按钮。
     *
     * @author qin.guoquan
     * @date 2026-05-09 150800
     */
    @Test
    void setResourceUsers_rejectsDefaultSuperAssistantResource() {
        mockI18n();

        AuthApplicationService service = new AuthApplicationService();
        SsResourceMapper ssResourceMapper = mock(SsResourceMapper.class);
        ReflectionTestUtils.setField(service, "ssResourceMapper", ssResourceMapper);

        SsResource defaultSuperAssistant = new SsResource();
        defaultSuperAssistant.setResourceId(100L);
        defaultSuperAssistant.setResourceBizType(ResourceBizTypeEnum.DIG_EMPLOYEE.name());
        defaultSuperAssistant.setOwnerType(OwnerType.PERSONAL_DEFAULT);
        defaultSuperAssistant.setResourceCode("user001_main");
        when(ssResourceMapper.selectById(100L)).thenReturn(defaultSuperAssistant);

        ResourceMemberSettingQo qo = new ResourceMemberSettingQo();
        qo.setResourceId(100L);

        assertThatThrownBy(() -> service.setResourceUsers(qo)).isInstanceOf(BaseException.class);
    }

    /**
     * 个人助理不对外开放管理授权、使用申请和申请审核；即使当前用户具备平台管理员能力，也要由资源类型兜底压住。
     */
    @Test
    void queryResourceOperationPermissions_rejectsPersonalAssistantAuthAndApplyActions() {
        AuthApplicationService service = new AuthApplicationService();
        SsResourceService ssResourceService = mock(SsResourceService.class);
        ReflectionTestUtils.setField(service, "ssResourceService", ssResourceService);

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
     * 默认超级助手即使是当前用户绑定的默认助理，也不允许编辑，避免登录初始化的底座资源被改坏。
     */
    @Test
    void queryResourceOperationPermissions_rejectsDefaultSuperAssistantEditAction() {
        AuthApplicationService service = new AuthApplicationService();
        SsResourceService ssResourceService = mock(SsResourceService.class);
        ReflectionTestUtils.setField(service, "ssResourceService", ssResourceService);

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

        assertThat(vo.getCanEdit()).isFalse();
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
        ReflectionTestUtils.setField(service, "privilegeGrantMapper", privilegeGrantMapper);
        ReflectionTestUtils.setField(service, "userService", userService);
        ReflectionTestUtils.setField(service, "organizationService", organizationService);

        Users user = new Users();
        user.setUserId(1001L);
        user.setUserName("tester");
        when(userService.findById(1001L)).thenReturn(user);
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
}
