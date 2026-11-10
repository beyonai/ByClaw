package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.common.i18n.I18nTestSupport;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatusResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCliRunner;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCliRunner.CliResult;
import com.iwhalecloud.byai.manager.domain.connector.provider.dingtalk.DwsDingtalkAuthorizationProvider;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorInfoService;
import com.iwhalecloud.byai.manager.domain.devloop.service.DwsAuthService;
import com.iwhalecloud.byai.manager.domain.users.service.UserExternalSystemService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.entity.users.Users;

@ExtendWith(MockitoExtension.class)
class DingtalkProactiveDwsExecutionTest extends I18nTestSupport {

    private static final List<String> LOOKUP = List.of("dws", "aisearch", "person", "--keyword", "employee-2",
        "--dimension", "jobNumber", "--format", "json");
    private static final List<String> SEND = List.of("dws", "chat", "message", "send", "--users", "staff-2",
        "--content", "test message", "--format", "json");

    @Spy private ObjectMapper objectMapper = new ObjectMapper();
    @Mock private DingtalkTokenService dingtalkTokenService;
    @Mock private DingtalkRobotConfigService dingtalkRobotConfigService;
    @Mock private DingtalkUserService dingtalkUserService;
    @Mock private UserService userService;
    @Mock private UserExternalSystemService userExternalSystemService;
    @Mock private DwsAuthService dwsAuthService;
    @Mock private DwsDingtalkAuthorizationProvider dwsAuthorizationProvider;
    @Mock private ConnectorInfoService connectorInfoService;
    @Mock private ConnectorCliRunner connectorCliRunner;
    @InjectMocks private DingtalkProactiveMessageService service;
    private Users receiver;

    @BeforeEach
    void setUp() {
        ConnectorInfo connector = new ConnectorInfo();
        when(connectorInfoService.findByCode("dingtalk")).thenReturn(connector);
        when(dwsAuthorizationProvider.verify(101L, connector)).thenReturn(
            new AuthorizationStatusResult(AuthorizationStatus.CONNECTED, null, null, null, null, null, null));
        receiver = new Users();
        receiver.setUserNumber("employee-2");
        when(userService.findById(202L)).thenReturn(receiver);
    }

    @Test
    void lookupAndSendUseSenderCredentialsAndKeepRecipientMapping() {
        when(dwsAuthService.runCommand(101L, LOOKUP, Duration.ofSeconds(10)))
            .thenReturn(new CliResult(0, "[{\"meta\":{\"jobNumber\":\"staff-2\"}}]"));
        when(dwsAuthService.runCommand(101L, SEND, Duration.ofSeconds(15)))
            .thenReturn(new CliResult(0, "{\"success\":true}"));

        service.sendUserToUserViaDws(101L, 202L, "test message");

        verify(dwsAuthService).runCommand(101L, LOOKUP, Duration.ofSeconds(10));
        verify(dwsAuthService).runCommand(101L, SEND, Duration.ofSeconds(15));
        verify(dwsAuthService, never()).runCommand(eq(202L), anyList(), any(Duration.class));
        verifyNoInteractions(connectorCliRunner, dingtalkTokenService, dingtalkRobotConfigService);
    }

    @Test
    void phoneLookupKeepsPriorityAndUsesSenderCredentials() {
        receiver.setPhone("encrypted-test-phone");
        List<String> phoneLookup = List.of("dws", "contact", "user", "search-mobile", "--mobile", "13800000000",
            "--format", "json");
        when(dwsAuthService.runCommand(101L, phoneLookup, Duration.ofSeconds(10)))
            .thenReturn(new CliResult(0, "{\"success\":true,\"result\":{\"userId\":\"staff-2\"}}"));
        when(dwsAuthService.runCommand(101L, SEND, Duration.ofSeconds(15)))
            .thenReturn(new CliResult(0, "{\"success\":true}"));

        try (var crypto = mockStatic(Sm4Util.class)) {
            crypto.when(() -> Sm4Util.decrypt("encrypted-test-phone")).thenReturn("13800000000");
            service.sendUserToUserViaDws(101L, 202L, "test message");
        }

        verify(dwsAuthService).runCommand(101L, phoneLookup, Duration.ofSeconds(10));
        verify(dwsAuthService).runCommand(101L, SEND, Duration.ofSeconds(15));
        verify(dwsAuthService, never()).runCommand(eq(101L), eq(LOOKUP), any(Duration.class));
        verifyNoInteractions(connectorCliRunner, dingtalkTokenService, dingtalkRobotConfigService);
    }

    @ParameterizedTest
    @MethodSource("incompleteResults")
    void incompleteLookupNeverSendsMessage(CliResult result) {
        when(dwsAuthService.runCommand(101L, LOOKUP, Duration.ofSeconds(10))).thenReturn(result);

        assertThatThrownBy(() -> service.sendUserToUserViaDws(101L, 202L, "test message"))
            .isInstanceOf(IllegalStateException.class);

        verify(dwsAuthService).runCommand(101L, LOOKUP, Duration.ofSeconds(10));
        verify(dwsAuthService, never()).runCommand(eq(101L), eq(SEND), any(Duration.class));
        verifyNoInteractions(connectorCliRunner, dingtalkTokenService, dingtalkRobotConfigService);
    }

    @ParameterizedTest
    @MethodSource("incompleteResults")
    void incompleteSendNeverReportsSuccessOrRetries(CliResult result) {
        when(dwsAuthService.runCommand(101L, LOOKUP, Duration.ofSeconds(10)))
            .thenReturn(new CliResult(0, "{\"success\":true,\"result\":{\"userId\":\"staff-2\"}}"));
        when(dwsAuthService.runCommand(101L, SEND, Duration.ofSeconds(15))).thenReturn(result);

        assertThatThrownBy(() -> service.sendUserToUserViaDws(101L, 202L, "test message"))
            .isInstanceOf(IllegalStateException.class);

        verify(dwsAuthService).runCommand(101L, SEND, Duration.ofSeconds(15));
        verifyNoInteractions(connectorCliRunner, dingtalkTokenService, dingtalkRobotConfigService);
    }

    static List<CliResult> incompleteResults() {
        return List.of(new CliResult(124, ""), new CliResult(1, "failed"),
            new CliResult(0, "{\"success\":true,\"result\":{\"userId\":\"staff-2\"}}", true));
    }
}
