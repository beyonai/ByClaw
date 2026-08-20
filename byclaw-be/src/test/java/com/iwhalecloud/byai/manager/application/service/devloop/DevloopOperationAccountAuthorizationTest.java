package com.iwhalecloud.byai.manager.application.service.devloop;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Locale;
import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.MessageSource;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.context.support.StaticMessageSource;
import org.springframework.test.util.ReflectionTestUtils;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.domain.devloop.service.OperationAccountAccessService;
import com.iwhalecloud.byai.manager.domain.devloop.service.OperationAccountService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectMemberService;
import com.iwhalecloud.byai.manager.dto.devloop.OperationAccountDTO;
import com.iwhalecloud.byai.manager.entity.devloop.OperationAccount;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectMapper;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;

@ExtendWith(MockitoExtension.class)
class DevloopOperationAccountAuthorizationTest {

    private static final long CURRENT_USER_ID = 10L;
    private static final String CURRENT_USER_CODE = "user-10";
    private static final long PROJECT_ID = 100L;

    @Mock
    private ProjectMapper projectMapper;

    @Mock
    private ProjectMemberService projectMemberService;

    @Mock
    private OperationAccountService operationAccountService;

    @Mock
    private OperationAccountAccessService operationAccountAccessService;

    @Mock
    private SsSandboxRecordMapper sandboxRecordMapper;

    private DevloopApplicationService service;
    private MessageSource originalMessageSource;

    @BeforeEach
    void setUp() {
        CurrentUserHolder.clearLoginInfo();
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(CURRENT_USER_ID);
        loginInfo.setUserCode(CURRENT_USER_CODE);
        CurrentUserHolder.setLoginInfo(loginInfo);

        originalMessageSource = (MessageSource) ReflectionTestUtils.getField(I18nUtil.class, "messageSource");
        StaticMessageSource messageSource = new StaticMessageSource();
        messageSource.addMessage("devloop.operationAccount.notFound", Locale.US, "account not found");
        messageSource.addMessage("devloop.operationAccount.parameter.required", Locale.US, "account required");
        messageSource.addMessage("devloop.operationAccount.id.required", Locale.US, "account id required");
        messageSource.addMessage("devloop.operationAccount.field.required", Locale.US, "account field required");
        messageSource.addMessage("devloop.operationAccount.browser.sandbox.required", Locale.US, "sandbox required");
        messageSource.addMessage("devloop.operationAccount.browser.sandbox.invalid", Locale.US, "invalid sandbox");
        messageSource.addMessage("devloop.operationRequirement.projectId.required", Locale.US, "project required");
        messageSource.addMessage("project.not.found", Locale.US, "project not found");
        messageSource.addMessage("devloop.operationRequirement.project.type.invalid", Locale.US, "invalid project type");
        messageSource.addMessage("devloop.operationRequirement.member.required", Locale.US, "member required");
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messageSource);
        LocaleContextHolder.setLocale(Locale.US);

        service = new DevloopApplicationService();
        ReflectionTestUtils.setField(service, "projectMapper", projectMapper);
        ReflectionTestUtils.setField(service, "projectMemberService", projectMemberService);
        ReflectionTestUtils.setField(service, "operationAccountService", operationAccountService);
        ReflectionTestUtils.setField(service, "operationAccountAccessService", operationAccountAccessService);
        ReflectionTestUtils.setField(service, "sandboxRecordMapper", sandboxRecordMapper);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", originalMessageSource);
        LocaleContextHolder.resetLocaleContext();
    }

    @Test
    void listsOnlyAccountsReturnedByAccessService() {
        allowProjectAccess(PROJECT_ID);
        OperationAccount owned = account(1L, PROJECT_ID, CURRENT_USER_ID);
        OperationAccount historicalShared = account(2L, PROJECT_ID, null);
        when(operationAccountAccessService.listAccessible(PROJECT_ID, CURRENT_USER_ID))
            .thenReturn(List.of(owned, historicalShared));

        ResponseUtil<List<Map<String, Object>>> response = service.listOperationAccounts(PROJECT_ID);

        assertThat(response.getCode()).isEqualTo(ResponseUtil.SUCCESS);
        assertThat(response.getData()).extracting(item -> item.get("accountId")).containsExactly(1L, 2L);
        InOrder ordered = inOrder(projectMapper, projectMemberService, operationAccountAccessService);
        ordered.verify(projectMapper).selectById(PROJECT_ID);
        ordered.verify(projectMemberService).isMember(PROJECT_ID, CURRENT_USER_ID);
        ordered.verify(operationAccountAccessService).listAccessible(PROJECT_ID, CURRENT_USER_ID);
        verify(operationAccountService, never()).listByProjectId(anyLong());
    }

    @Test
    void createAssignsCurrentUserInsteadOfProjectCreator() {
        allowProjectAccess(PROJECT_ID);
        OperationAccountDTO dto = validDto(null, PROJECT_ID);
        when(operationAccountService.create(any())).thenAnswer(invocation -> {
            OperationAccount created = invocation.getArgument(0);
            created.setAccountId(77L);
            return created;
        });

        ResponseUtil<Map<String, Object>> response = service.createOperationAccount(dto);

        ArgumentCaptor<OperationAccount> captor = ArgumentCaptor.forClass(OperationAccount.class);
        verify(operationAccountService).create(captor.capture());
        assertThat(response.getCode()).isEqualTo(ResponseUtil.SUCCESS);
        assertThat(response.getData()).containsEntry("accountId", 77L);
        assertThat(captor.getValue().getCreateBy()).isEqualTo(CURRENT_USER_ID);
    }

    @Test
    void preservesMissingUpdateParameterAndAccountIdErrorsBeforeAccountLookup() {
        ResponseUtil<Void> missingParameter = service.updateOperationAccount(null);
        ResponseUtil<Void> missingAccountId = service.updateOperationAccount(new OperationAccountDTO());

        assertThat(missingParameter.getCode()).isEqualTo(ResponseUtil.FAIL);
        assertThat(missingParameter.getMsg()).isEqualTo("account required");
        assertThat(missingAccountId.getCode()).isEqualTo(ResponseUtil.FAIL);
        assertThat(missingAccountId.getMsg()).isEqualTo("account id required");
        verify(operationAccountService, never()).findById(any());
    }

    @Test
    void rejectsUpdatingAnotherUsersPrivateAccountAsNotFound() {
        OperationAccount existing = account(1L, PROJECT_ID, 20L);
        when(operationAccountService.findById(1L)).thenReturn(existing);
        allowProjectAccess(PROJECT_ID);
        when(operationAccountAccessService.canAccess(existing, PROJECT_ID, CURRENT_USER_ID)).thenReturn(false);

        ResponseUtil<Void> response = service.updateOperationAccount(validDto(1L, 999L));

        assertNotFound(response);
        assertAuthorizationOrder(existing);
        verify(projectMapper, never()).selectById(999L);
        verify(operationAccountService, never()).update(any());
    }

    @Test
    void rejectsInvalidUpdateToAnotherUsersPrivateAccountAsNotFoundBeforeBusinessFieldValidation() {
        OperationAccount existing = account(4L, PROJECT_ID, 20L);
        when(operationAccountService.findById(4L)).thenReturn(existing);
        allowProjectAccess(PROJECT_ID);
        when(operationAccountAccessService.canAccess(existing, PROJECT_ID, CURRENT_USER_ID)).thenReturn(false);
        OperationAccountDTO invalidDto = new OperationAccountDTO();
        invalidDto.setAccountId(4L);

        ResponseUtil<Void> response = service.updateOperationAccount(invalidDto);

        assertNotFound(response);
        assertAuthorizationOrder(existing);
        verify(operationAccountService, never()).update(any());
    }

    @Test
    void preservesBusinessFieldValidationForAccessibleAccountUpdate() {
        OperationAccount existing = account(4L, PROJECT_ID, null);
        when(operationAccountService.findById(4L)).thenReturn(existing);
        allowProjectAccess(PROJECT_ID);
        when(operationAccountAccessService.canAccess(existing, PROJECT_ID, CURRENT_USER_ID)).thenReturn(true);
        OperationAccountDTO invalidDto = new OperationAccountDTO();
        invalidDto.setAccountId(4L);

        ResponseUtil<Void> response = service.updateOperationAccount(invalidDto);

        assertThat(response.getCode()).isEqualTo(ResponseUtil.FAIL);
        assertThat(response.getMsg()).isEqualTo("account field required");
        assertThat(response.getData()).isNull();
        assertAuthorizationOrder(existing);
        verify(operationAccountService, never()).update(any());
    }

    @ParameterizedTest
    @ValueSource(longs = { CURRENT_USER_ID, -1L })
    void allowsOwnerAndHistoricalSharedAccountUpdatesWithoutClaimingAccount(long creatorMarker) {
        Long creatorId = creatorMarker < 0 ? null : creatorMarker;
        OperationAccount existing = account(1L, PROJECT_ID, creatorId);
        when(operationAccountService.findById(1L)).thenReturn(existing);
        allowProjectAccess(PROJECT_ID);
        when(operationAccountAccessService.canAccess(existing, PROJECT_ID, CURRENT_USER_ID)).thenReturn(true);

        ResponseUtil<Void> response = service.updateOperationAccount(validDto(1L, 999L));

        ArgumentCaptor<OperationAccount> captor = ArgumentCaptor.forClass(OperationAccount.class);
        verify(operationAccountService).update(captor.capture());
        assertThat(response.getCode()).isEqualTo(ResponseUtil.SUCCESS);
        assertThat(captor.getValue().getCreateBy()).isNull();
        assertThat(captor.getValue().getProjectId()).isNull();
        assertThat(captor.getValue().getUpdateBy()).isEqualTo(CURRENT_USER_ID);
    }

    @Test
    void rejectsDeletingAnotherUsersPrivateAccountAsNotFound() {
        OperationAccount existing = account(2L, PROJECT_ID, 20L);
        when(operationAccountService.findById(2L)).thenReturn(existing);
        allowProjectAccess(PROJECT_ID);
        when(operationAccountAccessService.canAccess(existing, PROJECT_ID, CURRENT_USER_ID)).thenReturn(false);

        ResponseUtil<Void> response = service.deleteOperationAccount(2L);

        assertNotFound(response);
        assertAuthorizationOrder(existing);
        verify(operationAccountService, never()).delete(anyLong(), anyLong());
    }

    @ParameterizedTest
    @ValueSource(longs = { CURRENT_USER_ID, -1L })
    void allowsOwnerAndHistoricalSharedAccountDeletesWithoutClaimingAccount(long creatorMarker) {
        Long creatorId = creatorMarker < 0 ? null : creatorMarker;
        OperationAccount existing = account(2L, PROJECT_ID, creatorId);
        when(operationAccountService.findById(2L)).thenReturn(existing);
        allowProjectAccess(PROJECT_ID);
        when(operationAccountAccessService.canAccess(existing, PROJECT_ID, CURRENT_USER_ID)).thenReturn(true);

        ResponseUtil<Void> response = service.deleteOperationAccount(2L);

        assertThat(response.getCode()).isEqualTo(ResponseUtil.SUCCESS);
        verify(operationAccountService).delete(2L, CURRENT_USER_ID);
        verify(operationAccountService, never()).update(any());
        assertThat(existing.getCreateBy()).isEqualTo(creatorId);
    }

    @Test
    void rejectsLoggingIntoAnotherUsersPrivateAccountBeforeSandboxLookup() {
        OperationAccount existing = account(3L, PROJECT_ID, 20L);
        when(operationAccountService.findById(3L)).thenReturn(existing);
        allowProjectAccess(PROJECT_ID);
        when(operationAccountAccessService.canAccess(existing, PROJECT_ID, CURRENT_USER_ID)).thenReturn(false);

        ResponseUtil<Map<String, Object>> response = service.loginOperationAccount(3L, "sandbox-new");

        assertNotFound(response);
        assertAuthorizationOrder(existing);
        verify(sandboxRecordMapper, never()).selectRunningByUser(any());
        verify(operationAccountService, never()).update(any());
        verify(operationAccountAccessService, never()).hasUsableSandbox(any(), any());
    }

    @Test
    void preservesMissingLoginAccountIdErrorBeforeAccountLookup() {
        ResponseUtil<Map<String, Object>> response = service.loginOperationAccount(null, " ");

        assertThat(response.getCode()).isEqualTo(ResponseUtil.FAIL);
        assertThat(response.getMsg()).isEqualTo("account id required");
        assertThat(response.getData()).isNull();
        verify(operationAccountService, never()).findById(any());
        verify(sandboxRecordMapper, never()).selectRunningByUser(any());
    }

    @Test
    void rejectsBlankSandboxForAnotherUsersPrivateAccountAsNotFoundBeforeSandboxValidation() {
        OperationAccount existing = account(5L, PROJECT_ID, 20L);
        when(operationAccountService.findById(5L)).thenReturn(existing);
        allowProjectAccess(PROJECT_ID);
        when(operationAccountAccessService.canAccess(existing, PROJECT_ID, CURRENT_USER_ID)).thenReturn(false);

        ResponseUtil<Map<String, Object>> response = service.loginOperationAccount(5L, " ");

        assertNotFound(response);
        assertAuthorizationOrder(existing);
        verify(sandboxRecordMapper, never()).selectRunningByUser(any());
        verify(operationAccountService, never()).update(any());
    }

    @Test
    void preservesBlankSandboxValidationForAccessibleAccountLogin() {
        OperationAccount existing = account(5L, PROJECT_ID, null);
        when(operationAccountService.findById(5L)).thenReturn(existing);
        allowProjectAccess(PROJECT_ID);
        when(operationAccountAccessService.canAccess(existing, PROJECT_ID, CURRENT_USER_ID)).thenReturn(true);

        ResponseUtil<Map<String, Object>> response = service.loginOperationAccount(5L, " ");

        assertThat(response.getCode()).isEqualTo(ResponseUtil.FAIL);
        assertThat(response.getMsg()).isEqualTo("sandbox required");
        assertThat(response.getData()).isNull();
        assertAuthorizationOrder(existing);
        verify(sandboxRecordMapper, never()).selectRunningByUser(any());
        verify(operationAccountService, never()).update(any());
    }

    @ParameterizedTest
    @ValueSource(longs = { CURRENT_USER_ID, -1L })
    void allowsOwnerAndHistoricalSharedAccountLoginWithoutClaimingAccount(long creatorMarker) {
        Long creatorId = creatorMarker < 0 ? null : creatorMarker;
        OperationAccount existing = account(3L, PROJECT_ID, creatorId);
        existing.setConfig("{\"browserSessionId\":\"old-session\",\"keep\":\"yes\"}");
        when(operationAccountService.findById(3L)).thenReturn(existing);
        allowProjectAccess(PROJECT_ID);
        when(operationAccountAccessService.canAccess(existing, PROJECT_ID, CURRENT_USER_ID)).thenReturn(true);
        SsSandboxRecord running = new SsSandboxRecord();
        running.setSandboxId("sandbox-new");
        when(sandboxRecordMapper.selectRunningByUser(CURRENT_USER_CODE)).thenReturn(List.of(running));

        ResponseUtil<Map<String, Object>> response = service.loginOperationAccount(3L, " sandbox-new ");

        ArgumentCaptor<OperationAccount> captor = ArgumentCaptor.forClass(OperationAccount.class);
        verify(operationAccountService).update(captor.capture());
        OperationAccount update = captor.getValue();
        JSONObject config = JSON.parseObject(update.getConfig());
        assertThat(response.getCode()).isEqualTo(ResponseUtil.SUCCESS);
        assertThat(response.getData()).containsEntry("accountId", 3L).containsEntry("loginStatus", "online");
        assertThat(update.getCreateBy()).isNull();
        assertThat(update.getUpdateBy()).isEqualTo(CURRENT_USER_ID);
        assertThat(config.getString("browserSandboxId")).isEqualTo("sandbox-new");
        assertThat(config.getString("browserSessionId")).isNull();
        assertThat(config.getString("keep")).isEqualTo("yes");
        verify(operationAccountAccessService, never()).hasUsableSandbox(any(), any());
    }

    @Test
    void rejectsNewSandboxIdThatIsNotOwnedAndRunningAfterAccountAuthorization() {
        OperationAccount existing = account(3L, PROJECT_ID, CURRENT_USER_ID);
        when(operationAccountService.findById(3L)).thenReturn(existing);
        allowProjectAccess(PROJECT_ID);
        when(operationAccountAccessService.canAccess(existing, PROJECT_ID, CURRENT_USER_ID)).thenReturn(true);
        SsSandboxRecord differentSandbox = new SsSandboxRecord();
        differentSandbox.setSandboxId("sandbox-other");
        when(sandboxRecordMapper.selectRunningByUser(CURRENT_USER_CODE)).thenReturn(List.of(differentSandbox));

        ResponseUtil<Map<String, Object>> response = service.loginOperationAccount(3L, "sandbox-new");

        assertThat(response.getCode()).isEqualTo(ResponseUtil.FAIL);
        assertThat(response.getMsg()).isEqualTo("invalid sandbox");
        assertThat(response.getData()).isNull();
        verify(operationAccountService, never()).update(any());
        verify(operationAccountAccessService, never()).hasUsableSandbox(any(), any());
    }

    private void assertAuthorizationOrder(OperationAccount existing) {
        InOrder ordered = inOrder(operationAccountService, projectMapper, projectMemberService,
            operationAccountAccessService);
        ordered.verify(operationAccountService).findById(existing.getAccountId());
        ordered.verify(projectMapper).selectById(PROJECT_ID);
        ordered.verify(projectMemberService).isMember(PROJECT_ID, CURRENT_USER_ID);
        ordered.verify(operationAccountAccessService).canAccess(existing, PROJECT_ID, CURRENT_USER_ID);
    }

    private static void assertNotFound(ResponseUtil<?> response) {
        assertThat(response.getCode()).isEqualTo(ResponseUtil.FAIL);
        assertThat(response.getMsg()).isEqualTo("account not found");
        assertThat(response.getData()).isNull();
    }

    private void allowProjectAccess(Long projectId) {
        Project project = new Project();
        project.setProjectId(projectId);
        project.setProjectType("operation");
        project.setCreateBy(99L);
        project.setDeleteFlag("0");
        when(projectMapper.selectById(projectId)).thenReturn(project);
        when(projectMemberService.isMember(projectId, CURRENT_USER_ID)).thenReturn(true);
    }

    private static OperationAccountDTO validDto(Long accountId, Long projectId) {
        OperationAccountDTO dto = new OperationAccountDTO();
        dto.setAccountId(accountId);
        dto.setProjectId(projectId);
        dto.setPlatformCode("Xiaohongshu");
        dto.setAccountCode("account-code");
        dto.setAccountName("account-name");
        return dto;
    }

    private static OperationAccount account(Long accountId, Long projectId, Long createBy) {
        OperationAccount account = new OperationAccount();
        account.setAccountId(accountId);
        account.setProjectId(projectId);
        account.setCreateBy(createBy);
        account.setPlatformCode("Xiaohongshu");
        account.setAccountCode("account-code");
        account.setAccountName("account-name");
        account.setStatus("connected");
        account.setLoginStatus("offline");
        account.setStatusCd("00A");
        return account;
    }
}
