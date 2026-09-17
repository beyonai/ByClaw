package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Collections;
import java.util.List;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionExt;
import com.iwhalecloud.byai.state.domain.chat.model.ExternalChildSessionBinding;
import com.iwhalecloud.byai.state.domain.session.service.SessionExtService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionStatus;

@ExtendWith(MockitoExtension.class)
class ExternalChildSessionServiceTest {

    @Mock
    private SessionService sessionService;

    @Mock
    private SessionExtService sessionExtService;

    @Mock
    private SequenceService sequenceService;

    @Mock
    private PlatformTransactionManager transactionManager;

    private ExternalChildSessionService service;

    @BeforeEach
    void setUp() {
        service = new ExternalChildSessionService(sessionService, sessionExtService, sequenceService, transactionManager);
    }

    @Test
    void ensureBindingCreatesAChildThatInheritsParentOwnership() {
        ByaiSession parent = parentSession(100L, 900L);
        when(sessionService.findById(100L)).thenReturn(parent);
        when(sessionExtService.selectListByParamCodeAndValue("external_session_id", "worker-child-1"))
            .thenReturn(Collections.emptyList());
        when(sequenceService.nextVal()).thenReturn(200L, 201L, 202L, 203L, 204L, 205L, 206L, 207L, 208L);

        ExternalChildSessionBinding binding = service.ensureBinding(100L, childMetadata("worker-child-1"));

        assertThat(binding.session().getSessionId()).isEqualTo(200L);
        assertThat(binding.session().getParentSessionId()).isEqualTo(100L);
        assertThat(binding.session().getCreatorId()).isEqualTo(900L);
        assertThat(binding.session().getEnterpriseId()).isEqualTo(901L);
        assertThat(binding.session().getProjectId()).isEqualTo(902L);
        assertThat(binding.session().getObjectId()).isEqualTo(903L);
        assertThat(binding.session().getObjectType()).isEqualTo("Agent");
        assertThat(binding.session().getSessionName()).isEqualTo("架构舵手");
        assertThat(binding.messageId()).isEqualTo(201L);

        verify(sessionService).save(binding.session());
        ArgumentCaptor<ByaiSessionExt> extCaptor = ArgumentCaptor.forClass(ByaiSessionExt.class);
        verify(sessionExtService, times(8)).save(extCaptor.capture());
        assertThat(extCaptor.getAllValues())
            .extracting(ByaiSessionExt::getExtParamCode)
            .containsExactlyInAnyOrder(
                "external_session_id",
                "external_root_session_id",
                "external_team_id",
                "child_name",
                "child_role",
                "external_session_status",
                "external_message_id",
                "event_source"
            );
    }

    @Test
    void ensureBindingReturnsExistingParentScopedMapping() {
        ByaiSession child = parentSession(300L, 900L);
        child.setParentSessionId(100L);
        ByaiSessionExt externalId = ext(1L, 300L, "external_session_id", "worker-child-1");
        ByaiSessionExt messageId = ext(2L, 300L, "external_message_id", "301");
        when(sessionExtService.selectListByParamCodeAndValue("external_session_id", "worker-child-1"))
            .thenReturn(List.of(externalId));
        when(sessionService.findById(300L)).thenReturn(child);
        when(sessionExtService.findOneByExtParamCode(300L, "external_message_id")).thenReturn(messageId);

        ExternalChildSessionBinding first = service.ensureBinding(100L, childMetadata("worker-child-1"));
        ExternalChildSessionBinding second = service.ensureBinding(100L, childMetadata("worker-child-1"));

        assertThat(first.session().getSessionId()).isEqualTo(300L);
        assertThat(first.messageId()).isEqualTo(301L);
        assertThat(second).isSameAs(first);
        verify(sessionService, never()).save(any(ByaiSession.class));
        verify(transactionManager, times(1)).getTransaction(any());
        verify(transactionManager, times(1)).commit(any());
    }

    @Test
    void failedCommitDoesNotCacheTheChildBinding() {
        when(sessionExtService.selectListByParamCodeAndValue("external_session_id", "worker-child-1"))
            .thenReturn(Collections.emptyList());
        when(sessionService.findById(100L)).thenReturn(parentSession(100L, 900L));
        when(sequenceService.nextVal()).thenReturn(200L);
        TransactionStatus status = mock(TransactionStatus.class);
        when(transactionManager.getTransaction(any())).thenReturn(status);
        doThrow(new IllegalStateException("commit failed")).doNothing().when(transactionManager).commit(status);

        org.assertj.core.api.Assertions.assertThatThrownBy(
            () -> service.ensureBinding(100L, childMetadata("worker-child-1")))
            .hasMessage("commit failed");
        service.ensureBinding(100L, childMetadata("worker-child-1"));

        verify(transactionManager, times(2)).getTransaction(any());
        verify(sessionService, times(2)).save(any(ByaiSession.class));
    }

    @Test
    void ensureBindingDoesNotReuseTheSameExternalIdFromAnotherParent() {
        ByaiSession foreignChild = parentSession(300L, 999L);
        foreignChild.setParentSessionId(999L);
        when(sessionExtService.selectListByParamCodeAndValue("external_session_id", "shared-worker-id"))
            .thenReturn(List.of(ext(1L, 300L, "external_session_id", "shared-worker-id")));
        when(sessionService.findById(300L)).thenReturn(foreignChild);
        when(sessionService.findById(100L)).thenReturn(parentSession(100L, 900L));
        when(sequenceService.nextVal()).thenReturn(400L, 401L, 402L, 403L, 404L, 405L, 406L, 407L, 408L);

        ExternalChildSessionBinding binding = service.ensureBinding(100L, childMetadata("shared-worker-id"));

        assertThat(binding.session().getSessionId()).isEqualTo(400L);
        assertThat(binding.session().getParentSessionId()).isEqualTo(100L);
    }

    @Test
    void ensureBindingRejectsBlankExternalSessionIdWithoutWriting() {
        JSONObject metadata = childMetadata(" ");

        assertThatIllegalArgumentException()
            .isThrownBy(() -> service.ensureBinding(100L, metadata))
            .withMessageContaining("external_session_id");

        verify(sessionService, never()).save(any(ByaiSession.class));
    }

    private JSONObject childMetadata(String externalSessionId) {
        JSONObject metadata = new JSONObject();
        metadata.put("session_scope", "child");
        metadata.put("external_session_id", externalSessionId);
        metadata.put("external_root_session_id", "worker-root-1");
        metadata.put("event_source", "test-worker");
        metadata.put("team_id", "team-1");
        metadata.put("child_name", "架构舵手");
        metadata.put("child_role", "架构负责人");
        metadata.put("child_task", "分析父子会话架构");
        metadata.put("session_status", "running");
        return metadata;
    }

    private ByaiSession parentSession(Long sessionId, Long creatorId) {
        ByaiSession session = new ByaiSession();
        session.setSessionId(sessionId);
        session.setSessionName("父会话");
        session.setCreatorId(creatorId);
        session.setEnterpriseId(901L);
        session.setProjectId(902L);
        session.setObjectId(903L);
        session.setObjectType("Agent");
        session.setSessionType("H_AS");
        session.setIsDebug(0);
        return session;
    }

    private ByaiSessionExt ext(Long extId, Long sessionId, String code, String value) {
        ByaiSessionExt ext = new ByaiSessionExt();
        ext.setExtId(extId);
        ext.setSessionId(sessionId);
        ext.setExtParamCode(code);
        ext.setExtParamValue(value);
        return ext;
    }
}
