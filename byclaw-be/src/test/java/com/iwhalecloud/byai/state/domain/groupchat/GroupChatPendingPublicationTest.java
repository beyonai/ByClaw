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

import java.util.List;
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
import com.iwhalecloud.byai.manager.vo.resource.DirAndFileVo;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService;

class GroupChatPendingPublicationTest {
    private final ByaiGroupChatTaskMapper tasks = mock(ByaiGroupChatTaskMapper.class);
    private final ByaiGroupChatTaskPublicationMapper publications = mock(ByaiGroupChatTaskPublicationMapper.class);
    private final GroupChatTaskAuthorizationService authorization = mock(GroupChatTaskAuthorizationService.class);
    private final GroupChatPendingPublicationStore store = mock(GroupChatPendingPublicationStore.class);
    private final GroupChatPublicationUploader uploader = mock(GroupChatPublicationUploader.class);
    private final SessionService sessions = mock(SessionService.class);
    private final ProjectService projects = mock(ProjectService.class);
    private final SsResourceService resources = mock(SsResourceService.class);
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
        pending = new GroupChatPendingPublicationService(authorization, tasks, store, sequence);
        completion = new GroupChatTaskService(tasks, publications, null, messages, sequence, null, authorization,
            null, sessions, projects, resources,
            mock(GroupChatEventPublisher.class), store, uploader);
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
        file.setFileName("a.md");
        file.setFilePath("/group-task-results/60/100/0/a.md");
        doReturn(List.of(file)).when(uploader).upload(card, 777L);
        DirAndFileVo existing = new DirAndFileVo();
        existing.setName("a.md");
        existing.setType("file");
        when(resources.queryDirAndFileByLevel(any())).thenReturn(List.of(existing));
        assertThat(completion.complete(60L, confirm(100L)).getFiles()).containsExactly(file);
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
        verifyNoInteractions(uploader, messages);
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
