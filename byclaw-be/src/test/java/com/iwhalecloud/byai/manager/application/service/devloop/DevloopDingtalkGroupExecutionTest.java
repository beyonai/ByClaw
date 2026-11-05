package com.iwhalecloud.byai.manager.application.service.devloop;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockConstruction;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.time.Duration;
import java.util.List;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.i18n.I18nTestSupport;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCliRunner.CliResult;
import com.iwhalecloud.byai.manager.domain.devloop.service.DwsAuthService;

class DevloopDingtalkGroupExecutionTest extends I18nTestSupport {

    private DwsAuthService dws;
    private DevloopApplicationService service;

    @BeforeEach
    void setUp() {
        dws = mock(DwsAuthService.class);
        service = new DevloopApplicationService();
        ReflectionTestUtils.setField(service, "dwsAuthService", dws);
        LoginInfo login = new LoginInfo();
        login.setUserId(101L);
        CurrentUserHolder.setLoginInfo(login);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void groupSearchUsesCurrentUsersExecutionContext() throws Exception {
        List<String> command = List.of("dws", "chat", "search", "--query", "研发", "--format", "json");
        when(dws.runCommand(101L, command, Duration.ofSeconds(30), 1024 * 1024)).thenReturn(new CliResult(0,
            "{\"result\":{\"groups\":[{\"openConversationId\":\"group-1\",\"title\":\"研发群\"}]}}"));

        try (var localProcesses = mockConstruction(ProcessBuilder.class,
            (builder, context) -> when(builder.start()).thenThrow(new IOException("BE-local DWS forbidden")))) {
            var response = service.searchDingtalkGroups("研发");
            assertThat(response.isSuccess()).isTrue();
            assertThat(response.getData()).singleElement().satisfies(group -> assertThat(group)
                .containsEntry("openConversationId", "group-1").containsEntry("name", "研发群"));
            assertThat(localProcesses.constructed()).isEmpty();
        }
        verify(dws).runCommand(101L, command, Duration.ofSeconds(30), 1024 * 1024);
    }

    @ParameterizedTest
    @MethodSource("incompleteResults")
    void neverReportsFailedOrIncompleteOutputAsSuccessfulEmptySearch(CliResult result) throws Exception {
        when(dws.runCommand(eq(101L), anyList(), any(Duration.class), anyInt())).thenReturn(result);

        try (var ignored = mockConstruction(ProcessBuilder.class,
            (builder, context) -> when(builder.start()).thenThrow(new IOException("BE-local DWS forbidden")))) {
            assertThat(service.searchDingtalkGroups("研发").isSuccess()).isFalse();
        }
        verify(dws).runCommand(eq(101L), anyList(), eq(Duration.ofSeconds(30)), eq(1024 * 1024));
    }

    static List<CliResult> incompleteResults() {
        return List.of(new CliResult(124, ""), new CliResult(1, "{\"result\":{\"groups\":[]}}"),
            new CliResult(0, "{\"result\":{\"groups\":[]}}", true));
    }
}
