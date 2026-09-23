package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskMapper;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceAuthContextService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatPendingPublicationService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTaskDeliveryService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTaskService;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatTaskAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.interfaces.GroupChatTaskController;

class GroupChatTaskDeliveryServiceTest {
    private static final String PATH = "/.sessions/60/.byclaw/task-delivery.json";
    private static final String DIRECTORY = "/.sessions/60/.byclaw";
    private static final String VALID = "{\"schemaVersion\":\"1\",\"taskSessionId\":\"60\",\"delivered\":true}";
    private final UserFS storage = mock(UserFS.class);
    private final GroupChatTaskAuthorizationService authorization = mock(GroupChatTaskAuthorizationService.class);
    private final GroupChatTaskDeliveryService service = new GroupChatTaskDeliveryService(authorization, storage,
        new ObjectMapper());

    @BeforeEach
    void setup() {
        when(storage.list(DIRECTORY, 1)).thenReturn(List.of(PATH));
    }

    private void signal(String json) {
        when(storage.read(PATH)).thenAnswer(call -> new ByteArrayInputStream(json.getBytes(StandardCharsets.UTF_8)));
    }

    @Test
    void persistentSignalNeedsNoCurrentTurnOrAgentAndOnlyReadsStorage() {
        signal(VALID);
        assertThat(service.current(60L).delivered()).isTrue();
        assertThat(service.current(60L).delivered()).isTrue();
        var order = inOrder(authorization, storage);
        for (int index = 0; index < 2; index++) {
            order.verify(authorization).requireInitiator(60L);
            order.verify(storage).list(DIRECTORY, 1);
            order.verify(storage).read(PATH);
        }
        verifyNoMoreInteractions(storage);
    }

    @Test
    void acceptsMountedPathListingAndIgnoresExtraDescriptiveFields() {
        when(storage.list(DIRECTORY, 1)).thenReturn(List.of("/by" + PATH));
        signal(VALID.replace("}", ",\"agentId\":\"old-agent\",\"traceId\":\"old-turn\"}"));
        assertThat(service.current(60L).delivered()).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "not-json", "null", "[]", "{}",
        "{\"schemaVersion\":1,\"taskSessionId\":\"60\",\"delivered\":true}",
        "{\"schemaVersion\":\"2\",\"taskSessionId\":\"60\",\"delivered\":true}",
        "{\"schemaVersion\":\"1\",\"taskSessionId\":60,\"delivered\":true}",
        "{\"schemaVersion\":\"1\",\"taskSessionId\":\"61\",\"delivered\":true}",
        "{\"schemaVersion\":\"1\",\"taskSessionId\":\"60\",\"delivered\":\"true\"}",
        "{\"schemaVersion\":\"1\",\"taskSessionId\":\"60\",\"delivered\":false}",
        VALID + " {}"})
    void invalidSignalsAreNotDelivery(String json) {
        signal(json);
        assertThat(service.current(60L).delivered()).isFalse();
    }

    @Test
    void oversizedSignalIsNotAcceptedAndStreamIsClosed() throws Exception {
        InputStream input = spy(new ByteArrayInputStream((VALID + " ".repeat(16 * 1024))
            .getBytes(StandardCharsets.UTF_8)));
        when(storage.read(PATH)).thenReturn(input);
        assertThat(service.current(60L).delivered()).isFalse();
        verify(input).close();
    }

    @Test
    void missingSignalDoesNotReadOrCreateFile() {
        when(storage.list(DIRECTORY, 1)).thenReturn(List.of("/.sessions/61/.byclaw/task-delivery.json"));
        assertThat(service.current(60L).delivered()).isFalse();
        verify(storage).list(DIRECTORY, 1);
        verifyNoMoreInteractions(storage);
    }

    @Test
    void deniedTaskNeverTouchesUserStorage() {
        when(authorization.requireInitiator(60L)).thenThrow(new IllegalArgumentException("Access denied"));
        assertThatThrownBy(() -> service.current(60L)).hasMessage("Access denied");
        verifyNoInteractions(storage);
    }

    @ParameterizedTest
    @ValueSource(strings = {"missing-task", "other-user", "left-group"})
    void realAuthorizationRejectsUnauthorizedQueriesBeforeReadingFiles(String scenario) {
        ByaiGroupChatTaskMapper tasks = mock(ByaiGroupChatTaskMapper.class);
        GroupChatAuthorizationService groups = mock(GroupChatAuthorizationService.class);
        ByaiGroupChatTask task = new ByaiGroupChatTask();
        task.setTaskSessionId(60L);
        task.setGroupSessionId(10L);
        task.setInitiatorUserId(30L);
        when(tasks.selectById(60L)).thenReturn("missing-task".equals(scenario) ? null : task);
        if ("left-group".equals(scenario)) {
            when(groups.requireCurrentUserMember(10L)).thenThrow(new IllegalArgumentException("Not a member"));
        }
        LoginInfo login = new LoginInfo();
        login.setUserId("other-user".equals(scenario) ? 31L : 30L);
        CurrentUserHolder.setLoginInfo(login);
        try {
            GroupChatTaskAuthorizationService realAuthorization = new GroupChatTaskAuthorizationService(tasks, groups,
                mock(SessionMemberService.class), mock(ResourceAuthContextService.class), mock(SsResourceService.class));
            GroupChatTaskDeliveryService guarded = new GroupChatTaskDeliveryService(realAuthorization, storage,
                new ObjectMapper());
            assertThatThrownBy(() -> guarded.current(60L)).isInstanceOf(IllegalArgumentException.class);
            verifyNoInteractions(storage);
        }
        finally {
            CurrentUserHolder.clearLoginInfo();
        }
    }

    @Test
    void listingFailureIsRetryableInsteadOfFalse() {
        when(storage.list(DIRECTORY, 1)).thenThrow(new IllegalStateException("offline"));
        assertThatThrownBy(() -> service.current(60L)).isInstanceOf(IllegalStateException.class)
            .hasMessage("交付状态读取失败，请重试");
    }

    @Test
    void listedButUnreadableFileIsRetryableInsteadOfFalse() throws Exception {
        assertThatThrownBy(() -> service.current(60L)).hasMessage("交付状态读取失败，请重试");
        InputStream input = mock(InputStream.class);
        when(input.readNBytes(anyInt())).thenThrow(new IOException("disconnected"));
        when(storage.read(PATH)).thenReturn(input);
        assertThatThrownBy(() -> service.current(60L)).hasMessage("交付状态读取失败，请重试");
        verify(input).close();
    }

    @Test
    void httpEndpointPreservesEnvelopeAndStringTaskIdWithoutPublicationSideEffects() throws Exception {
        signal(VALID);
        GroupChatTaskService tasks = mock(GroupChatTaskService.class);
        GroupChatPendingPublicationService pending = mock(GroupChatPendingPublicationService.class);
        MockMvcBuilders.standaloneSetup(new GroupChatTaskController(tasks, pending, service)).build()
            .perform(get("/group-chat/tasks/60/delivery-status"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.code").value(0))
            .andExpect(jsonPath("$.data.taskId").value("60"))
            .andExpect(jsonPath("$.data.delivered").value(true));
        verifyNoInteractions(tasks, pending);
    }
}
