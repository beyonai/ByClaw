package com.iwhalecloud.byai.manager.application.service.auth;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.digitemploy.EmployeePublicationScopeService;
import com.iwhalecloud.byai.manager.domain.auth.service.PrivilegeGrantService;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.auth.PrivilegeGrantMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.manager.qo.auth.ResourceUseApplyApproveQo;
import com.iwhalecloud.byai.manager.qo.auth.ResourceUseApplyQo;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;

class EmployeeManagementApplyTest {
    @TempDir Path directory;
    JdbcTemplate jdbc;
    Object originalMessageSource;
    AuthApplicationService service = spy(new AuthApplicationService());
    PrivilegeGrantMapper grants = mock(PrivilegeGrantMapper.class);
    PrivilegeGrantService writes = mock(PrivilegeGrantService.class);
    SsResourceMapper resources = mock(SsResourceMapper.class);
    EmployeePublicationScopeService scopes = mock(EmployeePublicationScopeService.class);
    DigitalEmployeeResourceAuthorizationService synchronization = mock(DigitalEmployeeResourceAuthorizationService.class);
    SsResource employee = new SsResource();

    @BeforeEach void setup() {
        originalMessageSource = ReflectionTestUtils.getField(I18nUtil.class, "messageSource");
        if (TableInfoHelper.getTableInfo(PrivilegeGrant.class) == null) {
            TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), PrivilegeGrant.class);
        }
        jdbc = new JdbcTemplate(new UnpooledDataSource("org.sqlite.JDBC",
            "jdbc:sqlite:" + directory.resolve("applications.sqlite"), null, null));
        jdbc.execute("CREATE TABLE au_privilege_grant (privilege_grant_id BIGINT PRIMARY KEY, grant_type TEXT, "
            + "grant_obj_type TEXT, grant_obj_id BIGINT, grant_to_obj_type TEXT, grant_to_obj_id BIGINT, "
            + "grant_to_type TEXT, oper_type TEXT, status_cd TEXT)");
        when(grants.selectOne(any())).thenAnswer(call -> selectApplication(call.getArgument(0)));
        LoginInfo login = new LoginInfo(); login.setUserId(7L); login.setUserCode("reviewer");
        login.setEnterpriseId(1L); login.setUsersOrganizations(List.of()); CurrentUserHolder.setLoginInfo(login);
        employee.setResourceId(900L); employee.setComAcctId(1L); employee.setOwnerType("enterprise");
        employee.setCreateBy(8L); employee.setResourceCode("employee-900");
        employee.setResourceBizType("DIG_EMPLOYEE"); employee.setResourceStatus(2);
        ReflectionTestUtils.setField(service, "privilegeGrantMapper", grants);
        ReflectionTestUtils.setField(service, "privilegeGrantService", writes);
        ReflectionTestUtils.setField(service, "ssResourceMapper", resources);
        ReflectionTestUtils.setField(service, "employeeScopes", scopes);
        ReflectionTestUtils.setField(service, "employeeResourceAuthorizationService", synchronization);
        when(resources.selectById(900L)).thenReturn(employee);
        when(synchronization.lockForAuthorization(employee)).thenReturn(employee);
        doReturn(false).when(service).hasCurrentUserAllowManagePrivilege(employee);
        var messages = mock(org.springframework.context.MessageSource.class);
        when(messages.getMessage(anyString(), any(), any(java.util.Locale.class))).thenAnswer(call ->
            "auth.application.review.denied".equals(call.getArgument(0)) ? "没有该申请的审核权限" : call.getArgument(0));
        ReflectionTestUtils.setField(com.iwhalecloud.byai.common.i18n.I18nUtil.class, "messageSource", messages);
        doNothing().when(service).synchronizeDigitalEmployeeResourceUsers(any(), any());
        doNothing().when(service).syncUserAuthToRedis(anyLong());
    }

    @AfterEach void cleanup() {
        CurrentUserHolder.setLoginInfo(null);
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", originalMessageSource);
    }

    @Test void manageApplicationDoesNotCreateEffectiveManagementPermission() {
        doReturn(true).when(service).hasResourceAccessPermission(employee);
        doReturn(false).when(service).hasResourceManagePermission(employee);
        var request = new ResourceUseApplyQo(); request.setResourceId(900L); request.setPermissionType("MANAGE");
        service.applyUse(request);
        verify(writes).save(argThat(p -> "MANAGE_APPLY".equals(p.getGrantType()) && "P".equals(p.getStatusCd())
            && p.getGrantToObjId() == 7L && "WRITE".equals(p.getOperType())));
        verify(writes, never()).save(argThat(p -> "ALLOW_MANAGE".equals(p.getGrantType())));
    }

    ResourceUseApplyApproveQo pending() {
        return pending("MANAGE_APPLY", "WRITE");
    }

    ResourceUseApplyApproveQo pending(String grantType, String operType) {
        jdbc.update("INSERT INTO au_privilege_grant VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            100L, grantType, "DIG_EMPLOYEE", 900L, "USER", 42L, "RED", operType, "P");
        var request = new ResourceUseApplyApproveQo(); request.setResourceId(900L); request.setApplyUserId(42L);
        request.setAuditType("MANAGE_APPLY".equals(grantType) ? "MANAGE" : "USE");
        when(scopes.canReviewApplicant(employee, 42L)).thenReturn(true);
        return request;
    }

    /** 用服务生成的真实查询条件读取待审记录，避免 selectOne(any()) 掩盖 READ/WRITE 不匹配。 */
    private PrivilegeGrant selectApplication(LambdaQueryWrapper<PrivilegeGrant> query) {
        var matcher = Pattern.compile("#\\{ew\\.paramNameValuePairs\\.([^}]+)}").matcher(query.getSqlSegment());
        List<Object> parameters = new ArrayList<>();
        while (matcher.find()) parameters.add(query.getParamNameValuePairs().get(matcher.group(1)));
        List<PrivilegeGrant> matches = jdbc.query("SELECT * FROM au_privilege_grant WHERE " + matcher.replaceAll("?"),
            (row, index) -> {
                var apply = new PrivilegeGrant();
                apply.setPrivilegeGrantId(row.getLong("privilege_grant_id"));
                apply.setGrantType(row.getString("grant_type")); apply.setOperType(row.getString("oper_type"));
                apply.setGrantObjType(row.getString("grant_obj_type")); apply.setGrantObjId(row.getLong("grant_obj_id"));
                apply.setGrantToObjType(row.getString("grant_to_obj_type")); apply.setGrantToObjId(row.getLong("grant_to_obj_id"));
                apply.setGrantToType(row.getString("grant_to_type")); apply.setStatusCd(row.getString("status_cd"));
                return apply;
            }, parameters.toArray());
        return matches.isEmpty() ? null : matches.getFirst();
    }

    @Test void approvedManageApplicationGrantsManageAndRefreshesUserPermissions() {
        var request = pending(); when(grants.update(any(), any())).thenReturn(1);
        service.approveUseApply(request);
        verify(writes).save(argThat(p -> "ALLOW_MANAGE".equals(p.getGrantType()) && "A".equals(p.getStatusCd()) && p.getGrantToObjId() == 42L));
        verify(synchronization).synchronizeApprovedApplicant(employee, 42L);
        verify(service).syncUserAuthToRedis(42L);
    }

    @Test void rejectedManageApplicationDoesNotGrantOrSynchronizePermissions() {
        var request = pending(); when(grants.update(any(), any())).thenReturn(1);
        service.rejectUseApply(request);
        verify(grants).update(isNull(), any());
        verifyNoInteractions(writes);
        verify(service, never()).synchronizeDigitalEmployeeResourceUsers(any(), any());
        verify(service, never()).syncUserAuthToRedis(anyLong());
    }

    @Test void pendingManageApplicationPreventsDuplicateSubmission() {
        pending();
        CurrentUserHolder.getLoginInfo().setUserId(42L);
        doReturn(true).when(service).hasResourceAccessPermission(employee);
        doReturn(false).when(service).hasResourceManagePermission(employee);
        var request = new ResourceUseApplyQo(); request.setResourceId(900L); request.setPermissionType("MANAGE");
        assertThatThrownBy(() -> service.applyUse(request)).hasMessage("管理权限申请正在审核中");
        verifyNoInteractions(writes);
    }

    @ParameterizedTest @ValueSource(booleans = {true, false})
    void useApplicationStillFindsReadPermission(boolean approved) {
        var request = pending("AVAILABLE_USE", "READ"); when(grants.update(any(), any())).thenReturn(1);
        if (approved) {
            service.approveUseApply(request);
            verify(writes).save(argThat(p -> "FORCE_USE".equals(p.getGrantType()) && "READ".equals(p.getOperType())));
        } else {
            service.rejectUseApply(request);
            verifyNoInteractions(writes);
        }
        verify(grants).update(isNull(), any());
    }

    @ParameterizedTest @ValueSource(strings = {"READ", "other-resource", "other-applicant", "processed", "blacklist"})
    void manageReviewDoesNotMatchAnotherScopeOrProcessedApplication(String mismatch) {
        var request = pending();
        switch (mismatch) {
            case "READ" -> jdbc.update("UPDATE au_privilege_grant SET oper_type = 'READ'");
            case "other-resource" -> jdbc.update("UPDATE au_privilege_grant SET grant_obj_id = 901");
            case "other-applicant" -> jdbc.update("UPDATE au_privilege_grant SET grant_to_obj_id = 43");
            case "processed" -> jdbc.update("UPDATE au_privilege_grant SET status_cd = 'X'");
            case "blacklist" -> jdbc.update("UPDATE au_privilege_grant SET grant_to_type = 'BLACK'");
            default -> throw new IllegalArgumentException(mismatch);
        }
        assertThatThrownBy(() -> service.approveUseApply(request)).hasMessage("管理权限申请不存在或已处理");
        verify(grants, never()).update(any(), any());
        verifyNoInteractions(writes);
    }

    @Test void lostConcurrentDecisionCannotCreateASecondGrant() {
        var request = pending(); when(grants.update(any(), any())).thenReturn(0);
        assertThatThrownBy(() -> service.approveUseApply(request)).hasMessageContaining("已被处理");
        verifyNoInteractions(writes);
        verify(synchronization, never()).synchronizeApprovedApplicant(any(), any());
    }

    @Test void anOrganizationAdministratorCannotApproveAcrossThePublishedAudience() {
        var request = pending(); when(scopes.canReviewApplicant(employee, 42L)).thenReturn(false);
        assertThatThrownBy(() -> service.approveUseApply(request)).hasMessageContaining("审核权限");
        verify(grants, never()).update(any(), any()); verifyNoInteractions(writes);
    }
}
