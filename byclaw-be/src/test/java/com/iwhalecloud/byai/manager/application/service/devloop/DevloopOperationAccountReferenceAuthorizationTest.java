package com.iwhalecloud.byai.manager.application.service.devloop;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
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
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.MessageSource;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.context.support.StaticMessageSource;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.domain.devloop.service.OperationAccountAccessService;
import com.iwhalecloud.byai.manager.domain.devloop.service.OperationTaskSessionService;
import com.iwhalecloud.byai.manager.domain.devloop.service.OperationTaskTemplateService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectMemberService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ScanSourceService;
import com.iwhalecloud.byai.manager.dto.devloop.OperationRequirementDTO;
import com.iwhalecloud.byai.manager.dto.devloop.OperationRequirementStartDTO;
import com.iwhalecloud.byai.manager.dto.devloop.OperationTaskDTO;
import com.iwhalecloud.byai.manager.entity.devloop.OperationAccount;
import com.iwhalecloud.byai.manager.entity.devloop.OperationTaskTemplate;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectMember;
import com.iwhalecloud.byai.manager.entity.devloop.ScanSource;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMapper;
import com.iwhalecloud.byai.state.domain.chat.service.AssistantChatService;
import com.iwhalecloud.byai.state.domain.session.dto.SessionMembersDto;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

@ExtendWith(MockitoExtension.class)
class DevloopOperationAccountReferenceAuthorizationTest {

    private static final long USER_ID = 10L;
    private static final String USER_CODE = "user-10";
    private static final long PROJECT_ID = 100L;

    @Mock private ProjectMapper projectMapper;
    @Mock private ProjectMemberService projectMemberService;
    @Mock private ScanSourceService scanSourceService;
    @Mock private OperationTaskSessionService taskSessionService;
    @Mock private OperationTaskTemplateService templateService;
    @Mock private OperationAccountAccessService accountAccessService;
    @Mock private AssistantChatService assistantChatService;
    @Mock private ByaiSessionMapper byaiSessionMapper;
    @Mock private SequenceService sequenceService;
    @Mock private SessionService sessionService;
    @Mock private LoginApplicationService loginApplicationService;
    @Mock private SsResourceMapper ssResourceMapper;

    private DevloopApplicationService service;
    private MessageSource originalMessageSource;

    @BeforeEach
    void setUp() {
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(USER_ID);
        loginInfo.setUserCode(USER_CODE);
        CurrentUserHolder.setLoginInfo(loginInfo);

        originalMessageSource = (MessageSource) ReflectionTestUtils.getField(I18nUtil.class, "messageSource");
        StaticMessageSource messages = new StaticMessageSource();
        messages.addMessage("devloop.operationAccount.notFound", Locale.US, "account not found");
        messages.addMessage("devloop.operationAccount.browser.sandbox.invalid", Locale.US, "invalid sandbox");
        messages.addMessage("devloop.operationTaskTemplate.notFound", Locale.US, "template not found");
        messages.addMessage("devloop.operationTask.agents.required", Locale.US, "agents required");
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messages);
        LocaleContextHolder.setLocale(Locale.US);

        service = new DevloopApplicationService();
        ReflectionTestUtils.setField(service, "projectMapper", projectMapper);
        ReflectionTestUtils.setField(service, "projectMemberService", projectMemberService);
        ReflectionTestUtils.setField(service, "scanSourceService", scanSourceService);
        ReflectionTestUtils.setField(service, "operationTaskSessionService", taskSessionService);
        ReflectionTestUtils.setField(service, "operationTaskTemplateService", templateService);
        ReflectionTestUtils.setField(service, "operationAccountAccessService", accountAccessService);
        ReflectionTestUtils.setField(service, "assistantChatService", assistantChatService);
        ReflectionTestUtils.setField(service, "byaiSessionMapper", byaiSessionMapper);
        ReflectionTestUtils.setField(service, "sequenceService", sequenceService);
        ReflectionTestUtils.setField(service, "sessionService", sessionService);
        ReflectionTestUtils.setField(service, "loginApplicationService", loginApplicationService);
        ReflectionTestUtils.setField(service, "ssResourceMapper", ssResourceMapper);
        allowProject(PROJECT_ID);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", originalMessageSource);
        LocaleContextHolder.resetLocaleContext();
    }

    @Test
    void createRejectsInaccessiblePublishAccountBeforeWritingSource() {
        OperationRequirementDTO dto = requirement("publish", Map.of("publishAccountId", 41));
        when(accountAccessService.findAccessible(41L, PROJECT_ID, USER_ID)).thenReturn(null);

        ResponseUtil<Map<String, Object>> response = service.createOperationRequirement(dto);

        assertFailed(response, "account not found");
        verify(scanSourceService, never()).create(any());
    }

    @Test
    void createRejectsNonNumericRealAccountFieldWithoutLookingItUp() {
        OperationRequirementDTO dto = requirement("analyze", Map.of("accountId", "not-an-id"));

        ResponseUtil<Map<String, Object>> response = service.createOperationRequirement(dto);

        assertFailed(response, "account not found");
        verify(accountAccessService, never()).findAccessible(anyLong(), anyLong(), anyLong());
        verify(scanSourceService, never()).create(any());
    }

    @ParameterizedTest
    @ValueSource(strings = { "https://example.com/feed", "http://10.1.2.3", "http://172.16.2.3",
        "http://192.168.1.9", "http://localhost:8080", "http://collector.internal/path" })
    void collectAddressesAreNeverTreatedAsAccountIds(String address) {
        OperationRequirementDTO dto = requirement("collect", Map.of("accountOrAddress", address));
        ScanSource created = new ScanSource();
        created.setSourceId(88L);
        when(scanSourceService.create(any())).thenReturn(created);

        ResponseUtil<Map<String, Object>> response = service.createOperationRequirement(dto);

        assertThat(response.isSuccess()).isTrue();
        verify(accountAccessService, never()).findAccessible(anyLong(), anyLong(), anyLong());
    }

    @Test
    void analyzePrefersAccountIdOverLegacyAnalysisAccountId() {
        OperationRequirementDTO dto = requirement("analyze", Map.of("accountId", 51, "analysisAccountId", 52));
        when(accountAccessService.findAccessible(51L, PROJECT_ID, USER_ID)).thenReturn(account(51L));
        ScanSource created = new ScanSource();
        created.setSourceId(89L);
        when(scanSourceService.create(any())).thenReturn(created);

        ResponseUtil<Map<String, Object>> response = service.createOperationRequirement(dto);

        assertThat(response.isSuccess()).isTrue();
        verify(accountAccessService).findAccessible(51L, PROJECT_ID, USER_ID);
        verify(accountAccessService, never()).findAccessible(eq(52L), anyLong(), anyLong());
    }

    @Test
    void updateAuthorizesAgainstPersistedProjectBeforeAnyUpdate() {
        ScanSource existing = source(7L, PROJECT_ID, "publish", "{}");
        when(scanSourceService.findById(7L)).thenReturn(existing);
        OperationRequirementDTO dto = requirement("publish", Map.of("publishAccountId", 61));
        dto.setItemId(7L);
        dto.setProjectId(999L);
        when(accountAccessService.findAccessible(61L, PROJECT_ID, USER_ID)).thenReturn(null);

        ResponseUtil<Void> response = service.updateOperationRequirement(dto);

        assertFailed(response, "account not found");
        verify(accountAccessService).findAccessible(61L, PROJECT_ID, USER_ID);
        verify(projectMapper, never()).selectById(999L);
        verify(scanSourceService, never()).update(any());
    }

    @Test
    void startValidatesAllEffectiveTemplateReferencesBeforeCreatingAnySession() {
        ScanSource requirement = source(7L, PROJECT_ID, "collect", "{}");
        when(scanSourceService.findById(7L)).thenReturn(requirement);
        OperationTaskTemplate template = template(3L, "publish");
        when(templateService.get(3L)).thenReturn(template);
        when(accountAccessService.findAccessible(71L, PROJECT_ID, USER_ID)).thenReturn(null);
        OperationTaskDTO task = task(3L, Map.of("publishAccountId", 71));
        OperationRequirementStartDTO dto = new OperationRequirementStartDTO();
        dto.setRequirementId(7L);
        dto.setTasks(List.of(task));

        ResponseUtil<List<Map<String, Object>>> response = service.startOperationRequirement(dto);

        assertFailed(response, "account not found");
        verify(assistantChatService, never()).createGroupChatSession(any());
        verify(byaiSessionMapper, never()).updateById(any());
        verify(taskSessionService, never()).saveTaskExtensions(anyLong(), any());
    }

    @Test
    void executeValidatesMergedOverrideAndSandboxBeforeSavingAnything() {
        ByaiSession storedTask = new ByaiSession();
        storedTask.setSessionId(9L);
        storedTask.setProjectId(PROJECT_ID);
        when(taskSessionService.findById(9L)).thenReturn(storedTask);
        when(taskSessionService.getExtValues(9L)).thenReturn(Map.of(
            OperationTaskSessionService.EXT_STATUS, OperationTaskSessionService.STATUS_PENDING,
            OperationTaskSessionService.EXT_OPERATION_TYPE, "publish",
            OperationTaskSessionService.EXT_CONFIG, "{\"publishAccountId\":80}"));
        when(templateService.get(4L)).thenReturn(template(4L, "analyze"));
        OperationAccount account = account(81L);
        when(accountAccessService.findAccessible(81L, PROJECT_ID, USER_ID)).thenReturn(account);
        when(accountAccessService.hasUsableSandbox(account, USER_CODE)).thenReturn(false);
        OperationTaskDTO dto = new OperationTaskDTO();
        dto.setTaskId(9L);
        dto.setTemplateId(4L);
        dto.setConfig(Map.of("accountId", 81));

        ResponseUtil<Map<String, Object>> response = service.executeOperationTask(dto);

        assertFailed(response, "invalid sandbox");
        verify(accountAccessService).findAccessible(81L, PROJECT_ID, USER_ID);
        verify(accountAccessService).hasUsableSandbox(account, USER_CODE);
        verify(taskSessionService, never()).saveTaskExtensions(anyLong(), any());
        verify(byaiSessionMapper, never()).updateById(any());
        verify(assistantChatService, never()).createGroupChatSession(any());
    }

    @Test
    void runningTaskRejectsStoredInaccessibleAccountWithoutWritesOrChat() {
        stubRunningTask(11L, "publish", "{\"publishAccountId\":83}");
        when(accountAccessService.findAccessible(83L, PROJECT_ID, USER_ID)).thenReturn(null);
        OperationTaskDTO dto = new OperationTaskDTO();
        dto.setTaskId(11L);
        dto.setTemplateId(99L);
        dto.setConfig(Map.of("publishAccountId", 999));

        ResponseUtil<Map<String, Object>> response = service.executeOperationTask(dto);

        assertFailed(response, "account not found");
        verify(accountAccessService).findAccessible(83L, PROJECT_ID, USER_ID);
        verify(templateService, never()).get(anyLong());
        verify(taskSessionService, never()).saveTaskExtensions(anyLong(), any());
        verify(byaiSessionMapper, never()).updateById(any());
        verifyNoInteractions(assistantChatService);
    }

    @Test
    void runningTaskRejectsStoredAccountWithUnusableSandboxWithoutWritesOrChat() {
        stubRunningTask(12L, "publish", "{\"publishAccountId\":84}");
        OperationAccount account = account(84L);
        when(accountAccessService.findAccessible(84L, PROJECT_ID, USER_ID)).thenReturn(account);
        when(accountAccessService.hasUsableSandbox(account, USER_CODE)).thenReturn(false);
        OperationTaskDTO dto = new OperationTaskDTO();
        dto.setTaskId(12L);

        ResponseUtil<Map<String, Object>> response = service.executeOperationTask(dto);

        assertFailed(response, "invalid sandbox");
        verify(taskSessionService, never()).saveTaskExtensions(anyLong(), any());
        verify(byaiSessionMapper, never()).updateById(any());
        verifyNoInteractions(assistantChatService);
    }

    @Test
    void runningTaskWithoutStoredAccountReferenceRemainsIdempotentlySuccessful() {
        stubRunningTask(13L, "collect", "{\"accountOrAddress\":\"https://example.com/feed\"}");
        OperationTaskDTO dto = new OperationTaskDTO();
        dto.setTaskId(13L);

        ResponseUtil<Map<String, Object>> response = service.executeOperationTask(dto);

        assertThat(response.isSuccess()).isTrue();
        assertThat(response.getData()).containsEntry("taskId", 13L).containsEntry("sessionId", 13L);
        verify(accountAccessService, never()).findAccessible(anyLong(), anyLong(), anyLong());
        verify(taskSessionService, never()).saveTaskExtensions(anyLong(), any());
        verify(byaiSessionMapper, never()).updateById(any());
        verifyNoInteractions(assistantChatService);
    }

    @ParameterizedTest
    @ValueSource(booleans = { true, false })
    void executeRejectsMissingAgentsBeforeSavingAuthorizedOverrides(boolean referencesAccount) {
        ByaiSession storedTask = new ByaiSession();
        storedTask.setSessionId(10L);
        storedTask.setProjectId(PROJECT_ID);
        when(taskSessionService.findById(10L)).thenReturn(storedTask);
        when(taskSessionService.getExtValues(10L)).thenReturn(Map.of(
            OperationTaskSessionService.EXT_STATUS, OperationTaskSessionService.STATUS_PENDING,
            OperationTaskSessionService.EXT_OPERATION_TYPE, "collect",
            OperationTaskSessionService.EXT_CONFIG, "{}"));
        when(templateService.get(5L)).thenReturn(template(5L, "publish"));
        OperationTaskDTO dto = new OperationTaskDTO();
        dto.setTaskId(10L);
        dto.setTemplateId(5L);
        dto.setConfig(referencesAccount ? Map.of("publishAccountId", 82) : Map.of("topic", "release"));
        if (referencesAccount) {
            OperationAccount account = account(82L);
            when(accountAccessService.findAccessible(82L, PROJECT_ID, USER_ID)).thenReturn(account);
            when(accountAccessService.hasUsableSandbox(account, USER_CODE)).thenReturn(true);
        }

        ResponseUtil<Map<String, Object>> response = service.executeOperationTask(dto);

        assertFailed(response, "agents required");
        verify(taskSessionService, never()).saveTaskExtensions(anyLong(), any());
        verify(byaiSessionMapper, never()).updateById(any());
        verify(assistantChatService, never()).createGroupChatSession(any());
    }

    @ParameterizedTest
    @ValueSource(strings = { "https://example.com/feed", "http://10.1.2.3/feed",
        "http://localhost:8080/feed" })
    void scheduledCollectAddressesSkipAccountLookupAndUseSourceCreator(String address) {
        ScanSource source = source(12L, PROJECT_ID, "collect",
            "{\"accountOrAddress\":\"" + address + "\"}");
        source.setAssignee(22L);
        source.setCreateBy("33");
        ProjectMember member = new ProjectMember();
        member.setUserId(22L);
        member.setAgentId(44L);
        when(projectMemberService.listByProjectId(PROJECT_ID)).thenReturn(List.of(member));
        when(sequenceService.nextVal()).thenReturn(1000L, 1001L, 1002L);

        service.executeOperationSourceSchedule(source);

        ArgumentCaptor<SessionMembersDto> sessionCaptor = ArgumentCaptor.forClass(SessionMembersDto.class);
        verify(sessionService).createSessionMembers(sessionCaptor.capture());
        assertThat(sessionCaptor.getValue().getCreatorId()).isEqualTo(33L);
        assertThat(sessionCaptor.getValue().getMembers()).allMatch(memberItem -> memberItem.getCreatorId().equals(33L));
        verify(accountAccessService, never()).findAccessible(anyLong(), anyLong(), anyLong());
    }

    private void allowProject(long projectId) {
        Project project = new Project();
        project.setProjectId(projectId);
        project.setProjectType("operation");
        project.setCreateBy(USER_ID);
        project.setDeleteFlag("0");
        lenient().when(projectMapper.selectById(projectId)).thenReturn(project);
    }

    private void stubRunningTask(long taskId, String operationType, String config) {
        ByaiSession storedTask = new ByaiSession();
        storedTask.setSessionId(taskId);
        storedTask.setProjectId(PROJECT_ID);
        when(taskSessionService.findById(taskId)).thenReturn(storedTask);
        when(taskSessionService.getExtValues(taskId)).thenReturn(Map.of(
            OperationTaskSessionService.EXT_STATUS, OperationTaskSessionService.STATUS_RUNNING,
            OperationTaskSessionService.EXT_OPERATION_TYPE, operationType,
            OperationTaskSessionService.EXT_CONFIG, config));
    }

    private static OperationRequirementDTO requirement(String type, Map<String, Object> config) {
        OperationRequirementDTO dto = new OperationRequirementDTO();
        dto.setProjectId(PROJECT_ID);
        dto.setRequirementName("requirement");
        dto.setOperationType(type);
        dto.setConfig(config);
        return dto;
    }

    private static OperationTaskDTO task(Long templateId, Map<String, Object> config) {
        OperationTaskDTO dto = new OperationTaskDTO();
        dto.setTitle("task");
        dto.setAssignee(USER_ID);
        dto.setTemplateId(templateId);
        dto.setConfig(config);
        return dto;
    }

    private static ScanSource source(Long id, Long projectId, String type, String config) {
        ScanSource source = new ScanSource();
        source.setSourceId(id);
        source.setProjectId(projectId);
        source.setSourceName("source");
        source.setSourceType(type);
        source.setConfig(config);
        source.setDeleteFlag("0");
        return source;
    }

    private static OperationTaskTemplate template(Long id, String type) {
        OperationTaskTemplate template = new OperationTaskTemplate();
        template.setTemplateId(id);
        template.setTemplateType(type);
        return template;
    }

    private static OperationAccount account(Long id) {
        OperationAccount account = new OperationAccount();
        account.setAccountId(id);
        account.setProjectId(PROJECT_ID);
        account.setCreateBy(USER_ID);
        return account;
    }

    private static void assertFailed(ResponseUtil<?> response, String message) {
        assertThat(response.getCode()).isEqualTo(ResponseUtil.FAIL);
        assertThat(response.getMsg()).isEqualTo(message);
    }
}
