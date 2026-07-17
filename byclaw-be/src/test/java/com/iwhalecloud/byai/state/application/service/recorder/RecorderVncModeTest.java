package com.iwhalecloud.byai.state.application.service.recorder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.iwhalecloud.byai.state.domain.recorder.model.RecorderSession;
import com.iwhalecloud.byai.state.domain.recorder.model.RecorderOwner;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import java.util.Map;
import java.nio.file.Path;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class RecorderVncModeTest {

    @Test
    void bindVncStartsProviderAndReturnsConfiguredVncUrl() {
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(1L);
        loginInfo.setUserCode("alice");
        CurrentUserHolder.setLoginInfo(loginInfo);
        FakeVncProvider vnc = new FakeVncProvider();
        RecorderRequestRegistry requests = new RecorderRequestRegistry();
        RecorderDraftStore drafts = RecorderDraftStoreTestSupport.forFileRoot(Path.of("/tmp/recorder-vnc-test"));
        RecorderVerifyService verify = new RecorderVerifyService(new NoopVerifyPort(), requests);
        RecorderApplicationService service = new RecorderApplicationService(
            new RecorderSessionRegistry(),
            requests,
            new RecorderRankService(),
            new RecorderPipelineService(drafts, verify),
            new InMemoryRecorderBrowserPort(),
            vnc,
            verify,
            drafts,
            new RecorderCurrentUserProvider(),
            org.mockito.Mockito.mock(RecorderResourceSaveService.class)
        );

        RecorderResponse<Map<String, Object>> response = service.bind(Map.of(
            "mode", "bind_existing_page",
            "recordingMode", "vnc"
        ));

        assertThat(response.status()).isEqualTo(200);
        Map<String, Object> data = response.body().data();
        assertThat(data).containsEntry("recordingMode", "vnc")
            .containsEntry("vncUrl", "http://existing-vnc.example/vnc.html");
        assertThat(vnc.startedSessionId).isEqualTo(data.get("sessionId"));
    }

    @AfterEach
    void clearCurrentUser() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void externalVncProviderReadsExistingNoVncAndGatewayFromConfiguration() {
        RecorderBrowserProperties properties = new RecorderBrowserProperties();
        properties.setVncUrl("http://existing-vnc.example/vnc.html");
        properties.setGatewayHost("10.20.30.40");
        properties.setGatewayPort(17000);
        ExternalRecorderVncProvider provider = new ExternalRecorderVncProvider(properties);

        RecorderVncEndpoint endpoint = provider.start("session-1");

        assertThat(endpoint.provider()).isEqualTo("external");
        assertThat(endpoint.vncUrl()).isEqualTo("http://existing-vnc.example/vnc.html");
        assertThat(endpoint.gatewayHost()).isEqualTo("10.20.30.40");
        assertThat(endpoint.gatewayPort()).isEqualTo(17000);
        assertThat(endpoint.containerName()).isNull();
        assertThat(endpoint.vncPort()).isNull();
    }

    @Test
    void externalVncProviderRejectsMissingExistingNoVncConfiguration() {
        ExternalRecorderVncProvider provider = new ExternalRecorderVncProvider(new RecorderBrowserProperties());

        assertThatThrownBy(() -> provider.start("session-1"))
            .isInstanceOf(RecorderBrowserException.class)
            .extracting("code")
            .isEqualTo("validation_failed");
    }

    @Test
    void vncSessionUsesGatewayPortAndForegroundWindow() throws Exception {
        BycliRecorderBrowserPortTest.FakeDaemon defaultDaemon = null;
        BycliRecorderBrowserPortTest.FakeDaemon gatewayDaemon = null;
        try {
            defaultDaemon = BycliRecorderBrowserPortTest.FakeDaemon.start();
            gatewayDaemon = BycliRecorderBrowserPortTest.FakeDaemon.start();
            gatewayDaemon.enqueueJson(200, Map.of(
                "ok", true,
                "page", "container-page-1",
                "data", Map.of("title", "Container Search")
            ));
            RecorderBrowserProperties properties = new RecorderBrowserProperties();
            properties.setDaemonHost("127.0.0.1");
            properties.setDaemonPort(defaultDaemon.port());
            properties.setTimeoutMs(3000);
            BycliRecorderBrowserPort port = new BycliRecorderBrowserPort(properties);
            RecorderSession session = new RecorderSession("session-1", new RecorderOwner(1L, "alice"));
            session.contextId("ctx-1");
            session.recordingMode("vnc");
            session.gatewayHost("127.0.0.1");
            session.gatewayPort(gatewayDaemon.port());

            port.navigate(session, "https://example.com/search?q=alpha");

            assertThat(defaultDaemon.receivedCount()).isZero();
            assertThat(gatewayDaemon.lastBody()).containsEntry("action", "tabs")
                .containsEntry("op", "new")
                .containsEntry("windowMode", "foreground");
            assertThat(session.targetId()).isEqualTo("container-page-1");
        } finally {
            if (defaultDaemon != null) {
                defaultDaemon.close();
            }
            if (gatewayDaemon != null) {
                gatewayDaemon.close();
            }
        }
    }

    private static final class FakeVncProvider implements RecorderVncProvider {
        private String startedSessionId;

        @Override
        public RecorderVncEndpoint start(String sessionId) {
            this.startedSessionId = sessionId;
            return new RecorderVncEndpoint("external", "http://existing-vnc.example/vnc.html", "127.0.0.1", 17000, null, null);
        }

        @Override
        public void stop(String sessionId) {
        }

        @Override
        public void stopAll() {
        }
    }

    private static final class NoopVerifyPort implements RecorderVerifyPort {
        @Override
        public String start(
            String canonicalRequestId,
            String sessionId,
            String name,
            String adapterPath,
            Map<String, Object> executionSeedArgs
        ) {
            return canonicalRequestId;
        }

        @Override
        public Map<String, Object> status(String daemonRequestId) {
            return Map.of("status", "succeeded", "result", Map.of("ok", true, "rows", 1));
        }
    }
}
