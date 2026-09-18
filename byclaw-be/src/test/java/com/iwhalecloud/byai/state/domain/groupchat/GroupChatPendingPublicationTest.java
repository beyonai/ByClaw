package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.inOrder;

import java.sql.Connection;
import javax.sql.DataSource;
import java.util.List;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatExecution;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTurn;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatExecutionMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTurnMapper;
import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatExecutionCoordinator;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatAgentMention;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatAgentMentionParser;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;
import java.util.Date;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatPendingPublication;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTaskPublication;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatPendingPublicationMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskPublicationMapper;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatPendingPublicationStore;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatPendingPublicationService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatPublicationUploader;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTaskService;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatTaskAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatPendingPublicationRequest;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatTaskCompleteRequest;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatTaskFile;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatTaskPublicationResponse;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.common.feign.client.FeignPythonBuildService;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbListDir;
import com.iwhalecloud.byai.common.feign.response.PythonBuildResponse;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.Data;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.DirOrFile;
import com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationService;
import org.springframework.test.util.ReflectionTestUtils;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService;

class GroupChatPendingPublicationTest {
    private final GroupChatAgentMentionParser parser = mock(GroupChatAgentMentionParser.class);
    private final GroupChatExecutionCoordinator coordinator = mock(GroupChatExecutionCoordinator.class);
    private final ByaiGroupChatTurnMapper turns = mock(ByaiGroupChatTurnMapper.class);
    private final ByaiGroupChatExecutionMapper executions = mock(ByaiGroupChatExecutionMapper.class);
    private final ByaiGroupChatTaskMapper tasks = mock(ByaiGroupChatTaskMapper.class);
    private final ByaiGroupChatTaskPublicationMapper publications = mock(ByaiGroupChatTaskPublicationMapper.class);
    private final GroupChatTaskAuthorizationService authorization = mock(GroupChatTaskAuthorizationService.class);
    private final GroupChatPendingPublicationStore store = mock(GroupChatPendingPublicationStore.class);
    private final GroupChatPublicationUploader uploader = mock(GroupChatPublicationUploader.class);
    private final SessionService sessions = mock(SessionService.class);
    private final ProjectService projects = mock(ProjectService.class);
    private final SsResourceService resources = mock(SsResourceService.class);
    private final FeignPythonBuildService cloud = mock(FeignPythonBuildService.class);
    // 使用真实目录服务和 DTO 映射，仅模拟远端边界，覆盖发布与云盘查询的接线。
    private final DatasetApplicationService datasets = new DatasetApplicationService();
    private final GroupChatEventPublisher events = mock(GroupChatEventPublisher.class);
    private final SequenceService sequence = mock(SequenceService.class);
    private final ByaiMessageMapper messages = mock(ByaiMessageMapper.class);
    private final ByaiGroupChatTask task = new ByaiGroupChatTask();
    private GroupChatTaskService completion;
    private GroupChatPendingPublicationService pending;

    @BeforeEach
    void setUp() {
        LoginInfo login = new LoginInfo();
        login.setUserId(10L);
        CurrentUserHolder.setLoginInfo(login);
        task.setTaskSessionId(60L);
        task.setGroupSessionId(1L);
        task.setSourceMessageId(2L);
        task.setTargetAgentId(4L);
        task.setInitiatorUserId(10L);
        task.setStatus("ACTIVE");
        task.setTurnStatus("WAITING_USER");
        when(tasks.selectForUpdate(60L)).thenReturn(task);
        // 发布流程先读取任务所属群并加锁，再校验发起人权限。
        when(authorization.requireTask(60L)).thenReturn(task);
        when(authorization.requireInitiator(60L)).thenReturn(task);
        when(authorization.requireCanceller(60L)).thenReturn(task);
        when(sequence.nextVal()).thenReturn(100L, 101L, 102L);
        when(tasks.publish(eq(60L), any(), eq(10L), any())).thenReturn(1);
        when(store.response(any())).thenCallRealMethod();
        ReflectionTestUtils.setField(datasets, "ssResourceService", resources);
        ReflectionTestUtils.setField(datasets, "feignPythonBuildService", cloud);
        pending = new GroupChatPendingPublicationService(authorization, tasks, store, sequence);
        completion = new GroupChatTaskService(tasks, publications, executions, messages, sequence, null, authorization,
            null, sessions, projects, resources,
            events, store, uploader, datasets);
        GroupChatTopicTestSupport.install(completion, messages, 1L, 2L);
        ReflectionTestUtils.setField(completion, "mentionParser", parser);
        ReflectionTestUtils.setField(completion, "executionCoordinator", coordinator);
        ReflectionTestUtils.setField(completion, "turnMapper", turns);
        when(parser.parse(eq(1L), eq(4L), any())).thenAnswer(call ->
            new GroupChatAgentMention(call.getArgument(2), List.of()));
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    @Test
    void prepareDuringTurnReplacesWholeContentAndChangesIdWithoutUploading() {
        task.setTurnStatus("RUNNING");
        GroupChatPendingPublicationRequest request = request("first");
        request.setSourcePaths(List.of("/by/.sessions/60/REPORT.md"));
        assertThat(pending.prepare(60L, request).getPendingPublicationId()).isEqualTo(100L);
        assertThat(pending.prepare(60L, request("second")).getPendingPublicationId()).isEqualTo(101L);
        ArgumentCaptor<ByaiGroupChatPendingPublication> saved =
            ArgumentCaptor.forClass(ByaiGroupChatPendingPublication.class);
        verify(store, times(2)).replace(eq(task), saved.capture());
        assertThat(saved.getAllValues().get(1).getSourceFilesJson()).isEqualTo("[]");
        assertThat(saved.getAllValues().get(1).getTextContent()).isEqualTo("second");
        verifyNoInteractions(uploader, publications, messages);
    }

    @Test
    void matchingEditReplacesVersionAndResetsUploadProgressUnderTaskLock() {
        ByaiGroupChatPendingPublication existing = record(99L);
        existing.setSourceFilesJson("[\"/by/removed.md\",\"/by/kept.md\"]");
        existing.setUploadedFilesJson("{\"/by/removed.md\":{}}");
        existing.setCloudResourceId(777L);
        when(store.find(60L)).thenReturn(existing);
        GroupChatPendingPublicationRequest edit = request("  edited text  ");
        edit.setExpectedPendingPublicationId(99L);
        edit.setSourcePaths(List.of("/by/kept.md"));

        var response = pending.prepare(60L, edit);

        assertThat(response.getPendingPublicationId()).isEqualTo(100L);
        assertThat(response.getText()).isEqualTo("edited text");
        assertThat(response.getSourcePaths()).containsExactly("/by/kept.md");
        ArgumentCaptor<ByaiGroupChatPendingPublication> saved =
            ArgumentCaptor.forClass(ByaiGroupChatPendingPublication.class);
        var order = inOrder(authorization, tasks, store);
        order.verify(authorization).requireInitiator(60L);
        order.verify(tasks).selectForUpdate(60L);
        order.verify(store).find(60L);
        order.verify(store).replace(eq(task), saved.capture());
        assertThat(saved.getValue().getUploadedFilesJson()).isEqualTo("{}");
        assertThat(saved.getValue().getCloudResourceId()).isNull();
        verifyNoInteractions(uploader, publications, messages, cloud);
    }

    @ParameterizedTest
    @ValueSource(longs = {98L, 100L})
    void staleEditCannotReplaceCurrentContent(long expectedId) {
        when(store.find(60L)).thenReturn(record(99L));
        assertRejectedEdit(expectedId, "outdated");
    }

    @Test
    void editCannotRecreateMissingCard() {
        assertRejectedEdit(99L, "outdated");
    }

    @ParameterizedTest
    @ValueSource(longs = {0L, -1L})
    void editRejectsNonPositiveVersion(long expectedId) {
        assertRejectedEdit(expectedId, "must be positive");
    }

    @ParameterizedTest
    @ValueSource(strings = {"PUBLISHED", "CANCELLED"})
    void editRejectsClosedTaskBeforeReadingCard(String status) {
        task.setStatus(status);
        assertRejectedEdit(99L, "not active");
        verify(store, never()).find(any());
    }

    @Test
    void editRejectsMissingTaskAfterAuthorization() {
        when(tasks.selectForUpdate(60L)).thenReturn(null);
        assertRejectedEdit(99L, "not active");
        verify(store, never()).find(any());
    }

    @Test
    void editRequiresInitiatorBeforeLockingOrReadingCard() {
        when(authorization.requireInitiator(60L)).thenThrow(new IllegalArgumentException("forbidden"));
        assertRejectedEdit(99L, "forbidden");
        verifyNoInteractions(tasks);
        verify(store, never()).find(any());
    }

    @Test
    void editCannotClearBothTextAndFiles() {
        when(store.find(60L)).thenReturn(record(99L));
        GroupChatPendingPublicationRequest edit = request("  ");
        edit.setExpectedPendingPublicationId(99L);
        assertThatThrownBy(() -> pending.prepare(60L, edit)).hasMessageContaining("requires text or files");
        verify(store, never()).replace(any(), any());
        verifyNoInteractions(sequence, uploader, messages, events);
    }

    @Test
    void rejectedEditDoesNotWriteOrQueueNotification() {
        ByaiGroupChatPendingPublicationMapper mapper = mock(ByaiGroupChatPendingPublicationMapper.class);
        MultiDeviceBroadcastService broadcaster = mock(MultiDeviceBroadcastService.class);
        GroupChatPendingPublicationStore realStore = new GroupChatPendingPublicationStore(mapper, broadcaster);
        when(mapper.selectById(60L)).thenReturn(record(101L));
        pending = new GroupChatPendingPublicationService(authorization, tasks, realStore, sequence);
        TransactionSynchronizationManager.initSynchronization();
        GroupChatPendingPublicationRequest edit = request("stale");
        edit.setExpectedPendingPublicationId(100L);
        assertThatThrownBy(() -> pending.prepare(60L, edit)).hasMessageContaining("outdated");
        verify(mapper, never()).deleteById(any(Long.class));
        verify(mapper, never()).insert(any(ByaiGroupChatPendingPublication.class));
        assertThat(TransactionSynchronizationManager.getSynchronizations()).isEmpty();
        verifyNoInteractions(broadcaster, sequence);
    }

    private void assertRejectedEdit(long expectedId, String message) {
        GroupChatPendingPublicationRequest edit = request("changed");
        edit.setExpectedPendingPublicationId(expectedId);
        assertThatThrownBy(() -> pending.prepare(60L, edit)).hasMessageContaining(message);
        verify(store, never()).replace(any(), any());
        verifyNoInteractions(sequence, uploader, publications, messages, events);
    }

    @Test
    void unauthorizedPrepareAndQueryCannotReadOrReplaceContent() {
        when(authorization.requireInitiator(60L)).thenThrow(new IllegalArgumentException("forbidden"));
        assertThatThrownBy(() -> pending.prepare(60L, request("secret"))).hasMessage("forbidden");
        assertThatThrownBy(() -> pending.current(60L)).hasMessage("forbidden");
        verify(store, never()).find(any());
        verify(store, never()).replace(any(), any());
    }

    @Test
    void currentReturnsNullWithoutCardAndForClosedTask() {
        assertThat(pending.current(60L)).isNull();
        task.setStatus("CANCELLED");
        assertThat(pending.current(60L)).isNull();
        assertThatThrownBy(() -> pending.prepare(60L, request("late"))).hasMessage("Task is not active");
    }

    @Test
    void rejectsEmptyPreparation() {
        assertThatThrownBy(() -> pending.prepare(60L, request("  ")))
            .hasMessageContaining("requires text or files");
        verify(store, never()).replace(any(), any());
    }

    @ParameterizedTest
    @ValueSource(strings = {"/etc/passwd", "/by/../secret", "/by/.connector-auth/token", "/by/a/", "relative.md"})
    void rejectsInvalidFilePaths(String path) {
        GroupChatPendingPublicationRequest request = request("text");
        request.setSourcePaths(List.of(path));
        assertThatThrownBy(() -> pending.prepare(60L, request)).isInstanceOf(IllegalArgumentException.class);
        verify(store, never()).replace(any(), any());
    }

    @Test
    void staleCardCannotPublishNewerContent() {
        when(store.find(60L)).thenReturn(record(101L));
        assertThatThrownBy(() -> completion.complete(60L, confirm(100L))).hasMessageContaining("outdated");
        verifyNoInteractions(uploader, messages);
        verify(publications, never()).insert(any(ByaiGroupChatTaskPublication.class));
    }

    @Test
    void confirmUsesServerContentAndClearsOnlyAfterSuccessfulPublication() {
        when(store.find(60L)).thenReturn(record(100L));
        GroupChatTaskPublicationResponse response = completion.complete(60L, confirm(100L));
        assertThat(response.getText()).isEqualTo("server text");
        assertThat(response.getPendingPublicationId()).isEqualTo(100L);
        assertThat(task.getStatus()).isEqualTo("PUBLISHED");
        verify(store).clear(task, response.getMessageId());
        verifyNoInteractions(uploader);
    }

    @Test
    void filePublicationUsesProjectCloudAndKeepsCardIfUploadFails() {
        ByaiSession group = new ByaiSession();
        group.setProjectId(5L);
        when(sessions.findById(1L)).thenReturn(group);
        Project project = new Project();
        project.setCloudResourceId(777L);
        when(projects.findById(5L)).thenReturn(project);
        ByaiGroupChatPendingPublication card = record(100L);
        card.setSourceFilesJson("[\"/by/.sessions/60/a.md\"]");
        when(store.find(60L)).thenReturn(card);
        when(uploader.upload(card, 777L)).thenThrow(new IllegalStateException("upload failed"));
        assertThatThrownBy(() -> completion.complete(60L, confirm(100L))).hasMessage("upload failed");
        verify(publications, never()).insert(any(ByaiGroupChatTaskPublication.class));
        verify(store, never()).clear(any(), any());
        verifyNoInteractions(messages);

        GroupChatTaskFile file = new GroupChatTaskFile();
        file.setFileId(9007199254740993L);
        file.setFileName("a.md");
        file.setFilePath("/group-task-results/60/100/0/a.md");
        doReturn(List.of(file)).when(uploader).upload(card, 777L);
        mockCloudDirectory("file");
        assertThat(completion.complete(60L, confirm(100L)).getFiles()).containsExactly(file);
        ArgumentCaptor<KbListDir> query = ArgumentCaptor.forClass(KbListDir.class);
        verify(cloud).listDir(query.capture(), eq(777L));
        assertThat(query.getValue().getKnCode()).isEqualTo("project-cloud");
        assertThat(query.getValue().getDirectoryPath()).isEqualTo("/group-task-results/60/100/0");
        verify(resources, never()).queryDirAndFileByLevel(any());
        verify(store).clear(eq(task), any());
        ArgumentCaptor<JSONObject> event = ArgumentCaptor.forClass(JSONObject.class);
        verify(events, times(2)).publish(eq(1L), event.capture(), eq(null));
        JSONObject created = JSONObject.parseObject(event.getAllValues().get(0).toJSONString());
        JSONObject attachment = created.getJSONArray("attachments").getJSONObject(0);
        assertThat(attachment.get("fileId")).isEqualTo("9007199254740993");
        assertThat(attachment.getString("cloudResourceId")).isEqualTo("777");
        assertThat(attachment.getString("filePath")).isEqualTo(file.getFilePath());
        assertThat(file.getCloudResourceId()).isEqualTo("777");
        ArgumentCaptor<ByaiMessage> message = ArgumentCaptor.forClass(ByaiMessage.class);
        verify(messages).insert(message.capture());
        JSONObject metadata = JSONObject.parseObject(message.getValue().getMetadata());
        assertThat(metadata.getJSONArray("files").getJSONObject(0).getString("cloudResourceId")).isEqualTo("777");
    }

    @ParameterizedTest
    @ValueSource(strings = {"directory", "missing", "unavailable"})
    void cloudValidationFailureKeepsPendingCardAndDoesNotPublish(String result) {
        ByaiSession group = new ByaiSession();
        group.setProjectId(5L);
        when(sessions.findById(1L)).thenReturn(group);
        Project project = new Project();
        project.setCloudResourceId(777L);
        when(projects.findById(5L)).thenReturn(project);
        ByaiGroupChatPendingPublication card = record(100L);
        card.setSourceFilesJson("[\"/by/.sessions/60/a.md\"]");
        when(store.find(60L)).thenReturn(card);
        GroupChatTaskFile file = new GroupChatTaskFile();
        file.setFileId(9007199254740993L);
        file.setFileName("a.md");
        file.setFilePath("/group-task-results/60/100/0/a.md");
        when(uploader.upload(card, 777L)).thenReturn(List.of(file));
        mockCloudDirectory(result);
        if ("unavailable".equals(result)) {
            when(cloud.listDir(any(), eq(777L))).thenThrow(new IllegalStateException("cloud unavailable"));
        }

        assertThatThrownBy(() -> completion.complete(60L, confirm(100L)))
            .hasMessageContaining("unavailable".equals(result) ? "cloud unavailable" : "Project cloud file not found");
        verify(publications, never()).insert(any(ByaiGroupChatTaskPublication.class));
        verify(store, never()).clear(any(), any());
        verifyNoInteractions(messages);
        verify(tasks, never()).publish(any(), any(), any(), any());
        assertThat(task.getStatus()).isEqualTo("ACTIVE");
    }

    private void mockCloudDirectory(String type) {
        SsResource resource = new SsResource();
        resource.setResourceCode("project-cloud");
        when(resources.findById(777L)).thenReturn(resource);
        DirOrFile item = new DirOrFile();
        item.setName("/group-task-results/60/100/0/a.md");
        item.setType(type);
        Data data = new Data();
        data.setData("missing".equals(type) ? List.of() : List.of(item));
        PythonBuildResponse<Data> response = new PythonBuildResponse<>();
        response.setResultCode(PythonBuildResponse.RESPONSE_SUCCESS);
        response.setResultObject(data);
        when(cloud.listDir(any(), eq(777L))).thenReturn(response);
    }

    @Test
    void repeatedConfirmationReturnsExistingResultWithoutPendingRowOrUpload() {
        ByaiGroupChatTaskPublication published = new ByaiGroupChatTaskPublication();
        published.setTaskSessionId(60L);
        published.setPendingPublicationId(100L);
        published.setMessageId(999L);
        published.setFilesJson("[]");
        task.setStatus("PUBLISHED");
        when(publications.selectById(60L)).thenReturn(published);
        assertThat(completion.complete(60L, confirm(100L)).getMessageId()).isEqualTo(999L);
        assertThatThrownBy(() -> completion.complete(60L, confirm(99L))).hasMessageContaining("outdated");
        verify(store, never()).find(any());
        verifyNoInteractions(uploader, messages, coordinator, parser);
    }

    @Test
    void confirmationCannotOverrideTextOrPublishRunningTask() {
        GroupChatTaskCompleteRequest request = confirm(100L);
        request.setText("override");
        assertThatThrownBy(() -> completion.complete(60L, request)).hasMessageContaining("cannot be overridden");
        task.setTurnStatus("RUNNING");
        assertThatThrownBy(() -> completion.complete(60L, confirm(100L))).hasMessageContaining("not ready");
        verifyNoInteractions(uploader, messages);
    }

    @Test
    void failedFinalStateChangeDoesNotClearPendingData() {
        when(store.find(60L)).thenReturn(record(100L));
        when(tasks.publish(eq(60L), any(), eq(10L), any())).thenReturn(0);
        assertThatThrownBy(() -> completion.complete(60L, confirm(100L))).hasMessageContaining("concurrently");
        verify(store, never()).clear(any(), any());
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void resultMentionsUsePublishedMessageAndOriginalDelegationChain(boolean legacy) {
        ResourceVo agent = resultMention();
        ByaiGroupChatExecution parent = publicationParent(legacy);
        when(store.find(60L)).thenReturn(record(100L));

        GroupChatTaskPublicationResponse response = completion.complete(60L, confirm(100L));

        verify(coordinator).enqueueChild(parent, 40L, response.getMessageId(), response.getMessageId(),
            "{{DIG_EMPLOYEE_40}}", List.of(agent));
        ArgumentCaptor<ByaiMessage> saved = ArgumentCaptor.forClass(ByaiMessage.class);
        verify(messages).insert(saved.capture());
        assertThat(saved.getValue().getMessageContent()).isEqualTo("{{DIG_EMPLOYEE_40}}");
        assertThat(JSONObject.parseObject(saved.getValue().getMetadata()).getJSONArray("resourceList"))
            .hasSize(1);
        assertThat(response.getText()).isEqualTo(saved.getValue().getMessageContent());
        assertThat(task.getStatus()).isEqualTo("PUBLISHED");
        // 重试必须返回首次发布结果，不再次解析或创建委派。
        ArgumentCaptor<ByaiGroupChatTaskPublication> publication =
            ArgumentCaptor.forClass(ByaiGroupChatTaskPublication.class);
        verify(publications).insert(publication.capture());
        when(publications.selectById(60L)).thenReturn(publication.getValue());
        completion.complete(60L, confirm(100L));
        verify(coordinator, times(1)).enqueueChild(any(), any(), any(), any(), any(), any());
        verify(parser, times(1)).parse(any(), any(), any());
    }

    @Test
    void failedPublicationStateDoesNotScheduleMentions() {
        resultMention();
        when(store.find(60L)).thenReturn(record(100L));
        when(tasks.publish(eq(60L), any(), eq(10L), any())).thenReturn(0);

        assertThatThrownBy(() -> completion.complete(60L, confirm(100L))).hasMessageContaining("concurrently");

        verifyNoInteractions(coordinator);
    }

    @Test
    void delegationFailureRollsBackPublicationAndDoesNotBroadcast() throws Exception {
        resultMention();
        publicationParent(false);
        when(store.find(60L)).thenReturn(record(100L));
        when(coordinator.enqueueChild(any(), any(), any(), any(), any(), any()))
            .thenThrow(new IllegalStateException("queue unavailable"));
        Connection connection = mock(Connection.class);
        DataSource source = mock(DataSource.class);
        when(source.getConnection()).thenReturn(connection);
        when(connection.getAutoCommit()).thenReturn(true);
        ProxyFactory factory = new ProxyFactory(completion);
        factory.setProxyTargetClass(true);
        factory.addAdvice(new TransactionInterceptor(new DataSourceTransactionManager(source),
            new AnnotationTransactionAttributeSource()));
        GroupChatTaskService transactional = (GroupChatTaskService) factory.getProxy();

        assertThatThrownBy(() -> transactional.complete(60L, confirm(100L)))
            .hasMessageContaining("queue unavailable");

        verify(connection).rollback();
        verify(connection, never()).commit();
        verifyNoInteractions(events);
        verify(store, never()).clear(any(), any());
    }

    private ResourceVo resultMention() {
        ResourceVo agent = new ResourceVo();
        agent.setResourceType(AgentMetaEnum.DIG_EMPLOYEE);
        agent.setResourceId("40");
        when(parser.parse(1L, 4L, "server text"))
            .thenReturn(new GroupChatAgentMention("{{DIG_EMPLOYEE_40}}", List.of(agent)));
        return agent;
    }

    private ByaiGroupChatExecution publicationParent(boolean legacy) {
        task.setDispatchId(8L);
        ByaiGroupChatExecution parent;
        if (legacy) {
            parent = new ByaiGroupChatExecution();
            when(executions.selectByCandidateSessionId(60L)).thenReturn(parent);
        }
        else {
            ByaiGroupChatTurn turn = new ByaiGroupChatTurn();
            turn.setHopCount(3);
            when(turns.selectById(8L)).thenReturn(turn);
            parent = turn;
        }
        parent.setExecutionId(8L);
        parent.setCandidateSessionId(60L);
        parent.setGroupSessionId(1L);
        parent.setRootMessageId(2L);
        return parent;
    }

    @Test
    void cancellationClearsPendingCard() {
        when(tasks.cancel(eq(60L), any())).thenReturn(1);
        completion.cancel(60L);
        verify(store).clear(task, null);
    }

    @Test
    void privateNotificationOnlyFiresAfterCommitAndIdsAreStrings() {
        ByaiGroupChatPendingPublicationMapper mapper = mock(ByaiGroupChatPendingPublicationMapper.class);
        MultiDeviceBroadcastService broadcaster = mock(MultiDeviceBroadcastService.class);
        GroupChatPendingPublicationStore realStore = new GroupChatPendingPublicationStore(mapper, broadcaster);
        TransactionSynchronizationManager.initSynchronization();
        realStore.replace(task, record(100L));
        verifyNoInteractions(broadcaster);
        TransactionSynchronizationManager.getSynchronizations().forEach(TransactionSynchronization::afterCommit);
        ArgumentCaptor<JSONObject> event = ArgumentCaptor.forClass(JSONObject.class);
        verify(broadcaster).broadcastRawToUser(eq(10L), event.capture(), eq(null));
        assertThat(event.getValue().get("taskId")).isEqualTo("60");
        assertThat(event.getValue().get("pendingPublicationId")).isEqualTo("100");
        assertThat(event.getValue().get("type")).isEqualTo("GROUP_CHAT_TASK_EVENT");
    }

    @Test
    void rollbackDoesNotSendPreparedNotification() {
        MultiDeviceBroadcastService broadcaster = mock(MultiDeviceBroadcastService.class);
        GroupChatPendingPublicationStore realStore = new GroupChatPendingPublicationStore(
            mock(ByaiGroupChatPendingPublicationMapper.class), broadcaster);
        TransactionSynchronizationManager.initSynchronization();
        realStore.replace(task, record(100L));
        TransactionSynchronizationManager.getSynchronizations().forEach(
            synchronization -> synchronization.afterCompletion(TransactionSynchronization.STATUS_ROLLED_BACK));
        verifyNoInteractions(broadcaster);
    }

    private GroupChatPendingPublicationRequest request(String text) {
        GroupChatPendingPublicationRequest request = new GroupChatPendingPublicationRequest();
        request.setText(text);
        return request;
    }

    private GroupChatTaskCompleteRequest confirm(Long id) {
        GroupChatTaskCompleteRequest request = new GroupChatTaskCompleteRequest();
        request.setPendingPublicationId(id);
        return request;
    }

    private ByaiGroupChatPendingPublication record(Long id) {
        ByaiGroupChatPendingPublication record = new ByaiGroupChatPendingPublication();
        record.setTaskSessionId(60L);
        record.setPendingPublicationId(id);
        record.setTextContent("server text");
        record.setSourceFilesJson("[]");
        record.setCreateTime(new Date());
        return record;
    }
}
