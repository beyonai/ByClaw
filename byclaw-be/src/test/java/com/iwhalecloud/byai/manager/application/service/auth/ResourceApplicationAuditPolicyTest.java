package com.iwhalecloud.byai.manager.application.service.auth;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.lock.TransactionalRedisLockService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.login.bean.UsersOrganization;
import com.iwhalecloud.byai.common.constants.users.UserType;
import com.iwhalecloud.byai.manager.application.service.digitemploy.EmployeePublicationScopeService;
import com.iwhalecloud.byai.manager.domain.auth.service.PrivilegeGrantService;
import com.iwhalecloud.byai.manager.domain.organization.service.OrganizationService;
import com.iwhalecloud.byai.manager.domain.position.service.PositionService;
import com.iwhalecloud.byai.manager.domain.station.service.StationService;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.auth.PrivilegeGrantMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.manager.qo.auth.ResourceUseApplyApproveQo;
import com.iwhalecloud.byai.manager.vo.auth.DigitalEmployeeUseApplyAuditVo;
import java.util.*;
import java.util.stream.Stream;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
import org.springframework.context.MessageSource;
import org.springframework.test.util.ReflectionTestUtils;

class ResourceApplicationAuditPolicyTest {
    AuthApplicationService auth = spy(new AuthApplicationService());
    PrivilegeGrantMapper mapper = mock(PrivilegeGrantMapper.class);
    PrivilegeGrantService grants = mock(PrivilegeGrantService.class);
    SsResourceMapper resources = mock(SsResourceMapper.class);
    EmployeePublicationScopeService scopes = mock(EmployeePublicationScopeService.class);
    DigitalEmployeeResourceAuthorizationService synchronization = mock(DigitalEmployeeResourceAuthorizationService.class);
    SsResource resource = new SsResource();
    List<PrivilegeGrant> management = new ArrayList<>();
    DigitalEmployeeUseApplyAuditVo row = new DigitalEmployeeUseApplyAuditVo();
    ResourceUseApplyApproveQo request = new ResourceUseApplyApproveQo();

    @BeforeEach void setup() {
        LoginInfo login = new LoginInfo(); login.setUserId(7L); login.setUserCode("reviewer");
        login.setEnterpriseId(1L); login.setUsersOrganizations(List.of()); CurrentUserHolder.setLoginInfo(login);
        resource.setResourceId(900L); resource.setComAcctId(1L); resource.setOwnerType("enterprise");
        resource.setCreateBy(8L); resource.setResourceCode("employee-900"); resource.setResourceStatus(2);
        resource.setResourceBizType("DIG_EMPLOYEE"); resource.setPublicationSourceId(899L);
        ReflectionTestUtils.setField(auth, "privilegeGrantMapper", mapper);
        ReflectionTestUtils.setField(auth, "privilegeGrantService", grants);
        ReflectionTestUtils.setField(auth, "ssResourceMapper", resources);
        ReflectionTestUtils.setField(auth, "employeeScopes", scopes);
        ReflectionTestUtils.setField(auth, "employeeResourceAuthorizationService", synchronization);
        ReflectionTestUtils.setField(auth, "businessLocks", mock(TransactionalRedisLockService.class));
        ReflectionTestUtils.setField(auth, "organizationService", mock(OrganizationService.class));
        ReflectionTestUtils.setField(auth, "positionService", mock(PositionService.class));
        ReflectionTestUtils.setField(auth, "stationService", mock(StationService.class));
        when(grants.findPrivilegeByQo(any())).thenReturn(management);
        when(resources.selectById(900L)).thenReturn(resource);
        when(resources.selectBatchIds(any())).thenReturn(List.of(resource));
        when(synchronization.lockForAuthorization(resource)).thenReturn(resource);
        row.setResourceId(900L); row.setUserId(42L); row.setAuditType("USE");
        when(mapper.queryDigitalEmployeeUseApplyAudit(anyBoolean(), anyList(), any())).thenReturn(List.of(row));
        PrivilegeGrant pending = new PrivilegeGrant(); pending.setPrivilegeGrantId(100L); pending.setStatusCd("P");
        when(mapper.selectOne(any())).thenReturn(pending); when(mapper.update(any(), any())).thenReturn(1);
        request.setResourceId(900L); request.setApplyUserId(42L);
        doNothing().when(auth).syncUserAuthToRedis(anyLong());
        MessageSource messages = mock(MessageSource.class);
        when(messages.getMessage(anyString(), any(), any(Locale.class))).thenAnswer(call -> call.getArgument(0));
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messages);
    }

    @AfterEach void cleanup() { CurrentUserHolder.clearLoginInfo(); }

    static Stream<Arguments> decisions() {
        return Stream.of("DIG_EMPLOYEE:USE", "DIG_EMPLOYEE:MANAGE", "SKILL:USE", "KG_DOC:USE", "TOOLKIT:USE")
            .flatMap(type -> Stream.of("creator", "manager", "adminvip", "organization", "platform", "none",
                "expired", "future", "revoked", "blacklisted")
                .flatMap(role -> Stream.of(true, false).map(approve -> Arguments.of(type, role, approve))));
    }

    @ParameterizedTest @MethodSource("decisions")
    void listAndBothDecisionsUseTheSameFourReviewerRules(String type, String role, boolean approve) {
        String[] parts = type.split(":"); resource.setResourceBizType(parts[0]); row.setAuditType(parts[1]);
        request.setAuditType(parts[1]);
        if ("creator".equals(role)) resource.setCreateBy(7L);
        if ("adminvip".equals(role)) CurrentUserHolder.getLoginInfo().setUserCode("adminvip");
        if ("platform".equals(role)) {
            UsersOrganization organization = new UsersOrganization(); organization.setUserType(UserType.PLAT_MAN);
            CurrentUserHolder.getLoginInfo().setUsersOrganizations(List.of(organization));
        }
        if ("organization".equals(role)) when(scopes.canReviewApplicant(resource, 42L)).thenReturn(true);
        if (List.of("manager", "expired", "future", "revoked", "blacklisted").contains(role)) {
            PrivilegeGrant grant = new PrivilegeGrant(); grant.setGrantObjId(900L); grant.setGrantObjType(parts[0]);
            grant.setGrantType("ALLOW_MANAGE"); grant.setGrantToObjType("USER"); grant.setGrantToObjId(7L);
            grant.setGrantToType("RED"); grant.setStatusCd("A"); grant.setOperType("WRITE");
            if ("expired".equals(role)) grant.setExpDate(new Date(0));
            if ("future".equals(role)) grant.setEffDate(new Date(Long.MAX_VALUE));
            if ("revoked".equals(role)) grant.setStatusCd("X");
            if ("blacklisted".equals(role)) grant.setGrantToType("BLACK");
            management.add(grant);
        }
        boolean allowed = List.of("creator", "manager", "adminvip").contains(role)
            || "organization".equals(role) && "DIG_EMPLOYEE".equals(parts[0]);
        for (boolean history : List.of(false, true)) {
            var visible = auth.queryDigitalEmployeeUseApplyAudit(history, List.of(parts[0]));
            if (allowed) assertThat(visible).containsExactly(row); else assertThat(visible).isEmpty();
        }
        if (allowed) {
            if (approve) auth.approveUseApply(request); else auth.rejectUseApply(request);
            verify(mapper).update(any(), any());
            if (approve && "DIG_EMPLOYEE".equals(parts[0])) {
                verify(synchronization).synchronizeApprovedApplicant(resource, 42L);
            } else verify(synchronization, never()).synchronizeApprovedApplicant(any(), any());
        } else {
            assertThatThrownBy(() -> { if (approve) auth.approveUseApply(request); else auth.rejectUseApply(request); })
                .hasMessage("auth.application.review.denied");
            verify(mapper, never()).update(any(), any()); verify(grants, never()).save(any());
        }
    }

    @ParameterizedTest @NullSource @ValueSource(longs = {2L})
    void evenAdminVipCannotListOrApproveAnotherTenant(Long tenant) {
        CurrentUserHolder.getLoginInfo().setUserCode("adminvip"); resource.setComAcctId(tenant);
        assertThat(auth.queryDigitalEmployeeUseApplyAudit(false)).isEmpty();
        assertThatThrownBy(() -> auth.approveUseApply(request)).hasMessage("auth.application.review.denied");
        assertThatThrownBy(() -> auth.rejectUseApply(request)).hasMessage("auth.application.review.denied");
        verify(mapper, never()).update(any(), any());
    }

    @Test void lostOrganizationAuthorityBetweenQueryAndDecisionIsCheckedAgain() {
        when(scopes.canReviewApplicant(resource, 42L)).thenReturn(true);
        assertThat(auth.queryDigitalEmployeeUseApplyAudit(false)).containsExactly(row);
        when(scopes.canReviewApplicant(resource, 42L)).thenReturn(false);
        assertThatThrownBy(() -> auth.approveUseApply(request)).hasMessage("auth.application.review.denied");
        assertThatThrownBy(() -> auth.rejectUseApply(request)).hasMessage("auth.application.review.denied");
        verify(mapper, never()).update(any(), any());
    }
}
