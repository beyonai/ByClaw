package com.iwhalecloud.byai.state.interfaces.controller.recorder;

import static org.hamcrest.Matchers.startsWith;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;

import com.iwhalecloud.byai.state.application.service.recorder.InMemoryRecorderBrowserPort;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.state.application.service.recorder.RecorderApplicationService;
import com.iwhalecloud.byai.state.application.service.recorder.RecorderBycliPaths;
import com.iwhalecloud.byai.state.application.service.recorder.RecorderCurrentUserProvider;
import com.iwhalecloud.byai.state.application.service.recorder.RecorderDraftStore;
import com.iwhalecloud.byai.state.application.service.recorder.RecorderDraftStoreTestSupport;
import com.iwhalecloud.byai.state.application.service.recorder.RecorderPipelineService;
import com.iwhalecloud.byai.state.application.service.recorder.RecorderLlmServiceTestSupport;
import com.iwhalecloud.byai.state.application.service.recorder.RecorderRankService;
import com.iwhalecloud.byai.state.application.service.recorder.RecorderRequestRegistry;
import com.iwhalecloud.byai.state.application.service.recorder.RecorderResponse;
import com.iwhalecloud.byai.state.application.service.recorder.RecorderResourceSaveService;
import com.iwhalecloud.byai.state.application.service.recorder.RecorderSavePort;
import com.iwhalecloud.byai.state.application.service.recorder.RecorderSaveProperties;
import com.iwhalecloud.byai.state.application.service.recorder.RecorderSessionRegistry;
import com.iwhalecloud.byai.state.application.service.recorder.RecorderVerifyException;
import com.iwhalecloud.byai.state.application.service.recorder.RecorderVerifyPort;
import com.iwhalecloud.byai.state.application.service.recorder.RecorderVerifyService;
import com.iwhalecloud.byai.state.application.service.recorder.RecorderVncEndpoint;
import com.iwhalecloud.byai.state.application.service.recorder.RecorderVncProvider;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledOnOs;
import org.junit.jupiter.api.condition.OS;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
@DisabledOnOs(OS.WINDOWS)
class RecorderControllerTest {

    @TempDir
    Path tempDir;

    private RecorderSessionRegistry sessionRegistry;
    private RecorderDraftStore draftStore;
    private FakeVerifyPort verifyPort;
    private MockMvc mockMvc;
    private RecorderApplicationService service;
    private FakeVncProvider vncProvider;
    private RecorderSaveProperties saveProperties;
    private FakeSavePort savePort;

    @BeforeEach
    void setUp() {
        loginAs(1L, "alice");
        sessionRegistry = new RecorderSessionRegistry();
        RecorderRequestRegistry requestRegistry = new RecorderRequestRegistry();
        draftStore = RecorderDraftStoreTestSupport.forFileRoot(tempDir);
        verifyPort = new FakeVerifyPort();
        RecorderVerifyService verifyService = new RecorderVerifyService(verifyPort, requestRegistry);
        RecorderPipelineService pipelineService = new RecorderPipelineService(
            draftStore, verifyService, RecorderLlmServiceTestSupport.unavailable()
        );
        saveProperties = new RecorderSaveProperties();
        saveProperties.setProductionEnabled(true);
        savePort = new FakeSavePort();
        RecorderResourceSaveService resourceSaveService = new RecorderResourceSaveService(
            saveProperties, pipelineService, savePort
        );
        vncProvider = new FakeVncProvider();
        service = new RecorderApplicationService(
            sessionRegistry,
            requestRegistry,
            new RecorderRankService(),
            pipelineService,
            new InMemoryRecorderBrowserPort(),
            vncProvider,
            verifyService,
            draftStore,
            new RecorderCurrentUserProvider(),
            resourceSaveService,
            RecorderLlmServiceTestSupport.unavailable()
        );
        mockMvc = MockMvcBuilders.standaloneSetup(new RecorderController(service)).build();
    }

    @AfterEach
    void clearCurrentUser() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void healthReturnsOpenCliEnvelope() throws Exception {
        CurrentUserHolder.clearLoginInfo();
        mockMvc.perform(get("/recorder/health"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.ok").value(true))
            .andExpect(jsonPath("$.schemaVersion").value("recorder.v1"))
            .andExpect(jsonPath("$.requestId", startsWith("req_")))
            .andExpect(jsonPath("$.data.localService").value("ok"))
            .andExpect(jsonPath("$.data.daemon").value("down"))
            .andExpect(jsonPath("$.data.extension").value("disconnected"))
            .andExpect(jsonPath("$.data.highLevel").value("down"))
            .andExpect(jsonPath("$.data.llmSynthesis").value(false))
            .andExpect(jsonPath("$.data.llmSynthesisReason").value("default_model_list_lookup_failed"))
            .andExpect(jsonPath("$.error").doesNotExist());
    }

    @Test
    void anonymousBindAndProtectedEndpointsRequireAuthentication() throws Exception {
        CurrentUserHolder.clearLoginInfo();

        mockMvc.perform(post("/recorder/session/bind")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"mode\":\"bind_existing_page\"}"))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.error.code").value("authentication_required"));

        mockMvc.perform(post("/recorder/navigate")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"sessionId\":\"missing\",\"url\":\"https://example.com\"}"))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.error.code").value("authentication_required"));

        mockMvc.perform(get("/recorder/requests/missing-request"))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.error.code").value("authentication_required"));

        mockMvc.perform(post("/recorder/save")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"sessionId\":\"missing\",\"draftId\":\"draft_0\"}"))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.error.code").value("authentication_required"));
        org.assertj.core.api.Assertions.assertThat(savePort.publishCalls).hasValue(0);
    }

    @Test
    void anotherUserCannotUseSessionOrCancelItsResources() throws Exception {
        String sessionId = bindAndRankSession();
        Path draftPath = Path.of(generateDraft(sessionId));
        String state = sessionRegistry.get(sessionId).orElseThrow().state().wireValue();

        loginAs(2L, "bob");

        for (String endpointAndBody : java.util.List.of(
            "/recorder/navigate\n{\"sessionId\":\"%s\",\"url\":\"https://example.com\"}",
            "/recorder/save\n{\"sessionId\":\"%s\",\"draftId\":\"draft_0\"}",
            "/recorder/draft/verify\n{\"sessionId\":\"%s\",\"draftId\":\"draft_0\"}"
        )) {
            String[] request = endpointAndBody.formatted(sessionId).split("\\n", 2);
            mockMvc.perform(post(request[0])
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(request[1]))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("session_not_found"));
        }

        mockMvc.perform(post("/recorder/cancel")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"sessionId\":\"%s\",\"scope\":\"session\"}".formatted(sessionId)))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error.code").value("session_not_found"));

        org.assertj.core.api.Assertions.assertThat(sessionRegistry.get(sessionId).orElseThrow().state().wireValue()).isEqualTo(state);
        org.assertj.core.api.Assertions.assertThat(draftPath).exists();
        org.assertj.core.api.Assertions.assertThat(vncProvider.stopCalls).hasValue(0);
        org.assertj.core.api.Assertions.assertThat(savePort.publishCalls).hasValue(0);
    }

    @Test
    void anotherUserCannotPollOwnedRequest() throws Exception {
        String sessionId = bindAndRankSession();
        MvcResult accepted = mockMvc.perform(post("/recorder/pipeline/score")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"sessionId\":\"%s\"}".formatted(sessionId)))
            .andExpect(status().isAccepted())
            .andReturn();
        String requestId = JsonTestValue.readString(accepted, "$.requestId");

        loginAs(2L, "bob");
        mockMvc.perform(get("/recorder/requests/{requestId}", requestId))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error.code").value("request_not_found"));
    }

    @Test
    void bindAndCaptureFlowReturnsMockCompatibleShapes() throws Exception {
        String bindBody = """
            {"mode":"bind_existing_page","recordingMode":"tab_projection"}
            """;
        MvcResult bind = mockMvc.perform(post("/recorder/session/bind")
                .contentType(MediaType.APPLICATION_JSON)
                .content(bindBody))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.ok").value(true))
            .andExpect(jsonPath("$.data.sessionId", startsWith("session_")))
            .andExpect(jsonPath("$.data.contextId").value(nullValue()))
            .andExpect(jsonPath("$.data.awaitingLogin").value(false))
            .andReturn();

        String sessionId = JsonTestValue.readString(bind, "$.data.sessionId");

        mockMvc.perform(post("/recorder/navigate")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"sessionId":"%s","url":"https://example.com/search?q=alpha"}
                    """.formatted(sessionId)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.state").value("page_ready"))
            .andExpect(jsonPath("$.data.url").value("https://example.com/search?q=alpha"));

        mockMvc.perform(post("/recorder/capture/start")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"sessionId":"%s","sampleName":"A","trigger":"user_manual"}
                    """.formatted(sessionId)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.sampleName").value("A"))
            .andExpect(jsonPath("$.data.started").value(true));

        mockMvc.perform(post("/recorder/capture/read")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"sessionId":"%s","sampleName":"A","seed":"alpha"}
                    """.formatted(sessionId)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.sampleName").value("A"))
            .andExpect(jsonPath("$.data.entries[0].requestId").value("A-1"))
            .andExpect(jsonPath("$.data.entries[0].method").value("GET"))
            .andExpect(jsonPath("$.data.entries[0].url").value("https://example.com/search?q=alpha"));
    }

    @Test
    void asyncPipelineEndpointsCanBePolledByRequestId() throws Exception {
        String sessionId = bindAndRankSession();

        MvcResult accepted = mockMvc.perform(post("/recorder/pipeline/score")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"sessionId":"%s","llmEgressAcknowledgedAt":1760000000000}
                    """.formatted(sessionId)))
            .andExpect(status().isAccepted())
            .andExpect(jsonPath("$.ok").value(true))
            .andExpect(jsonPath("$.requestId", startsWith("req_")))
            .andExpect(jsonPath("$.data.accepted").value(true))
            .andReturn();

        String requestId = JsonTestValue.readString(accepted, "$.requestId");

        mockMvc.perform(get("/recorder/requests/{requestId}", requestId))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.ok").value(true))
            .andExpect(jsonPath("$.data.requestId").value(requestId))
            .andExpect(jsonPath("$.data.status").value("succeeded"))
            .andExpect(jsonPath("$.data.result.candidates[0].id").value("cand_example_com_search"))
            .andExpect(jsonPath("$.data.result.scorePrompt").exists())
            .andExpect(jsonPath("$.data.result.sentCandidateIds[0]").value("cand_example_com_search"));
    }

    @Test
    void rankDerivesCandidateFromCapturedEntries() throws Exception {
        MvcResult bind = mockMvc.perform(post("/recorder/session/bind")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"mode":"bind_existing_page"}
                    """))
            .andExpect(status().isOk())
            .andReturn();
        String sessionId = JsonTestValue.readString(bind, "$.data.sessionId");

        captureSample(sessionId, "A", "https://api.example.test/v1/search?keyword=alpha", "alpha");
        captureSample(sessionId, "B", "https://api.example.test/v1/search?keyword=beta", "beta");

        mockMvc.perform(post("/recorder/rank")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"sessionId":"%s"}
                    """.formatted(sessionId)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.candidates[0].id").value("cand_api_example_test_v1_search"))
            .andExpect(jsonPath("$.data.candidates[0].endpoint.host").value("api.example.test"))
            .andExpect(jsonPath("$.data.candidates[0].endpoint.pathname").value("/v1/search"))
            .andExpect(jsonPath("$.data.candidates[0].endpoint.queryParams.keyword").value("{keyword}"))
            .andExpect(jsonPath("$.data.candidates[0].args[0].paramName").value("keyword"));
    }

    @Test
    void generatedDraftsAreStoredAndUnknownDraftsAreRejected() throws Exception {
        String sessionId = bindAndRankSession();

        MvcResult generated = mockMvc.perform(post("/recorder/pipeline/generate")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"sessionId":"%s","llmEgressAcknowledgedAt":1760000000000}
                    """.formatted(sessionId)))
            .andExpect(status().isAccepted())
            .andReturn();
        String requestId = JsonTestValue.readString(generated, "$.requestId");

        mockMvc.perform(get("/recorder/requests/{requestId}", requestId))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.result.drafts[0].id").value("draft_0"))
            .andExpect(jsonPath("$.data.result.drafts[0].candidateId").value("cand_example_com_search"))
            .andExpect(jsonPath("$.data.result.drafts[0].verify.ok").value(false))
            .andExpect(jsonPath("$.data.result.drafts[0].verify.reasons[0]").value("pending verification"))
            .andExpect(jsonPath("$.data.result.drafts[0].usable").value(false))
            .andExpect(jsonPath("$.data.result.drafts[0].source", containsString("import { cli, Strategy } from '@sovovs/bycli/registry'")))
            .andExpect(jsonPath("$.data.result.drafts[0].source", containsString("cli({")))
            .andExpect(jsonPath("$.data.result.drafts[0].source", containsString("site: 'example_com'")))
            .andExpect(jsonPath("$.data.result.drafts[0].source", containsString("name: 'search'")))
            .andExpect(jsonPath("$.data.result.drafts[0].filePath").value("clis/example_com/search.js"))
            .andExpect(jsonPath("$.data.result.drafts[0].savePath").value("clis/example_com/search.js"))
            .andExpect(jsonPath("$.data.result.drafts[0].verificationPath").doesNotExist())
            .andExpect(jsonPath("$.data.result.drafts[0].verificationPaths").doesNotExist())
            .andExpect(content().string(org.hamcrest.Matchers.not(containsString(tempDir.toString()))))
            .andExpect(content().string(org.hamcrest.Matchers.not(containsString("/by/.bycli"))));

        mockMvc.perform(post("/recorder/draft/verify")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"sessionId":"%s","draftId":"missing"}
                    """.formatted(sessionId)))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("validation_failed"));

        mockMvc.perform(post("/recorder/save")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"sessionId":"%s","draftId":"missing"}
                    """.formatted(sessionId)))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("validation_failed"));
    }

    @Test
    void generateMapsStorageFailureToStableSafeEnvelope() throws Exception {
        String sessionId = bindAndRankSession();
        Path outside = Path.of("/tmp");
        Files.createSymbolicLink(tempDir.resolve("byclaw-alice"), outside);

        mockMvc.perform(post("/recorder/pipeline/generate")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"sessionId":"%s","llmEgressAcknowledgedAt":1760000000000}
                    """.formatted(sessionId)))
            .andExpect(status().isServiceUnavailable())
            .andExpect(jsonPath("$.error.code").value("bycli_storage_unavailable"))
            .andExpect(jsonPath("$.error.message").value("bycli storage unavailable"))
            .andExpect(content().string(org.hamcrest.Matchers.not(containsString(tempDir.toString()))));
    }

    @Test
    void draftVerifyExposesRunningThenExpectationShapedTerminalResult() throws Exception {
        String sessionId = bindAndRankSession();
        String draftPath = generateDraft(sessionId);
        RecorderBycliPaths paths = (RecorderBycliPaths) internalDraft(sessionId).get("verificationPaths");
        String editedSource = "export const edited = true;";
        verifyPort.allowTerminal = false;

        MvcResult accepted = mockMvc.perform(post("/recorder/draft/verify")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"sessionId":"%s","draftId":"draft_0","source":"%s"}
                    """.formatted(sessionId, editedSource)))
            .andExpect(status().isAccepted())
            .andExpect(jsonPath("$.requestId", startsWith("req_")))
            .andReturn();
        String requestId = JsonTestValue.readString(accepted, "$.requestId");

        mockMvc.perform(get("/recorder/requests/{requestId}", requestId))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.requestId").value(requestId))
            .andExpect(jsonPath("$.data.status").value("running"));

        verifyPort.allowTerminal = true;
        awaitRequestStatus(requestId, "succeeded")
            .andExpect(jsonPath("$.data.result.draftId").value("draft_0"))
            .andExpect(jsonPath("$.data.result.verify.ok").value(true))
            .andExpect(jsonPath("$.data.result.usable").value(true))
            .andExpect(jsonPath("$.data.result.verifiedSourceHash")
                .value("7d2d77478afeb3a0f17224c7c4347610115bcb5a25b34bc5795401384ff5c857"));
        org.assertj.core.api.Assertions.assertThat(verifyPort.adapterPath).isEqualTo(paths.daemonPath().toString());
        org.assertj.core.api.Assertions.assertThat(Path.of(draftPath)).exists();
        org.assertj.core.api.Assertions.assertThat(Files.readString(Path.of(draftPath))).isEqualTo(editedSource);
    }

    @Test
    void draftVerifyRejectsBlankSourceBeforeWritingOrStartingDaemon() throws Exception {
        String sessionId = bindAndRankSession();
        String draftPath = generateDraft(sessionId);
        String original = Files.readString(Path.of(draftPath));

        mockMvc.perform(post("/recorder/draft/verify")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"sessionId":"%s","draftId":"draft_0","source":"  \\n"}
                    """.formatted(sessionId)))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("validation_failed"))
            .andExpect(jsonPath("$.error.message")
                .value("adapter source must be nonblank and at most 1048576 UTF-8 bytes"));

        org.assertj.core.api.Assertions.assertThat(Files.readString(Path.of(draftPath))).isEqualTo(original);
        org.assertj.core.api.Assertions.assertThat(verifyPort.startCalls).hasValue(0);
    }

    @Test
    void verifyUsesOneCanonicalRequestIdAndStartFailureDoesNotAdvanceSession() throws Exception {
        String sessionId = bindAndRankSession();
        mockMvc.perform(post("/recorder/init")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"sessionId":"%s","name":"example/search","selectedCandidateId":"cand_example_com_search","writePolicy":"write"}
                    """.formatted(sessionId)))
            .andExpect(status().isOk());

        verifyPort.startFailure = new RecorderVerifyException("daemon_unavailable", "daemon unavailable");
        mockMvc.perform(post("/recorder/verify")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"sessionId":"%s","name":"example/search","adapterPath":"/tmp/draft.ts"}
                    """.formatted(sessionId)))
            .andExpect(status().isServiceUnavailable())
            .andExpect(jsonPath("$.error.code").value("daemon_unavailable"));

        verifyPort.startFailure = new RecorderVerifyException("daemon_timeout", "SECRET timeout detail");
        mockMvc.perform(post("/recorder/verify")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"sessionId":"%s","name":"example/search","adapterPath":"/tmp/draft.ts"}
                    """.formatted(sessionId)))
            .andExpect(status().isGatewayTimeout())
            .andExpect(jsonPath("$.error.code").value("verify_timeout"))
            .andExpect(jsonPath("$.error.message").value("verify runner timed out"))
            .andExpect(jsonPath("$.error.message").value(org.hamcrest.Matchers.not(containsString("SECRET"))));

        verifyPort.startFailure = null;
        verifyPort.allowTerminal = false;
        MvcResult accepted = mockMvc.perform(post("/recorder/verify")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"sessionId":"%s","name":"example/search","adapterPath":"/tmp/draft.ts"}
                    """.formatted(sessionId)))
            .andExpect(status().isAccepted())
            .andExpect(jsonPath("$.data.state").value("verifying"))
            .andReturn();
        String requestId = JsonTestValue.readString(accepted, "$.requestId");
        org.assertj.core.api.Assertions.assertThat(verifyPort.canonicalRequestId).isEqualTo(requestId);

        mockMvc.perform(get("/recorder/requests/{requestId}", requestId))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.status").value("running"));
        verifyPort.allowTerminal = true;
        awaitRequestStatus(requestId, "succeeded")
            .andExpect(jsonPath("$.data.result.ok").value(true));
    }

    @Test
    void initDryRunGeneratesInspectableSourceFromSelectedCandidate() throws Exception {
        String sessionId = bindAndRankSession();

        mockMvc.perform(post("/recorder/init")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"sessionId":"%s","name":"example/search","selectedCandidateId":"cand_example_com_search","writePolicy":"dry-run"}
                    """.formatted(sessionId)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.generatedSource", containsString("export default")))
            .andExpect(jsonPath("$.data.generatedSource", containsString("/search")))
            .andExpect(jsonPath("$.data.generatedSource", not("export default {};")))
            .andExpect(jsonPath("$.data.report.warnings[0]", containsString("no filesystem write was performed")));
    }

    @Test
    void cancelDeletesSessionTemporaryDraftDirectory() throws Exception {
        String sessionId = bindAndRankSession();
        Path draftPath = Path.of(generateDraft(sessionId));
        org.assertj.core.api.Assertions.assertThat(draftPath).exists();

        mockMvc.perform(post("/recorder/cancel")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"sessionId":"%s","scope":"session"}
                    """.formatted(sessionId)))
            .andExpect(status().isOk());

        org.assertj.core.api.Assertions.assertThat(Files.exists(draftPath)).isFalse();
        org.assertj.core.api.Assertions.assertThat(Files.exists(draftPath.getParent())).isFalse();
    }

    @Test
    void cancelSucceedsAndStopsResourcesWhenDraftCleanupFails() throws Exception {
        String sessionId = bindAndRankSession();
        Path draftPath = Path.of(generateDraft(sessionId));
        Path recorderDrafts = draftPath.getParent().getParent();
        Path savedDrafts = recorderDrafts.resolveSibling(".recorder-drafts-safe");
        Path outside = Path.of("/tmp");
        Files.move(recorderDrafts, savedDrafts);
        Files.createSymbolicLink(recorderDrafts, outside);

        mockMvc.perform(post("/recorder/cancel")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"sessionId":"%s","scope":"session"}
                    """.formatted(sessionId)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.cancelled").value(true))
            .andExpect(content().string(org.hamcrest.Matchers.not(containsString(tempDir.toString()))));

        org.assertj.core.api.Assertions.assertThat(sessionRegistry.get(sessionId).orElseThrow().state().wireValue())
            .isEqualTo("cancelled");
        org.assertj.core.api.Assertions.assertThat(vncProvider.stopCalls).hasValue(1);
        org.assertj.core.api.Assertions.assertThat(savedDrafts.resolve(sessionId)).exists();
    }

    @Test
    void nonSuccessfulDraftTerminalsReplacePendingVerificationWithFailureReason() throws Exception {
        for (String terminal : java.util.List.of("failed", "timeout", "cancelled")) {
            String sessionId = bindAndRankSession();
            GeneratedDraft generated = generateDraftWithRequest(sessionId);
            verifyPort.terminalStatus = terminal;
            verifyPort.allowTerminal = true;

            MvcResult accepted = mockMvc.perform(post("/recorder/draft/verify")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""
                        {"sessionId":"%s","draftId":"draft_0"}
                        """.formatted(sessionId)))
                .andExpect(status().isAccepted())
                .andReturn();
            String verifyRequestId = JsonTestValue.readString(accepted, "$.requestId");
            awaitRequestStatus(verifyRequestId, terminal);

            Map<String, Object> draft = internalDraft(sessionId);
            org.assertj.core.api.Assertions.assertThat(((Map<?, ?>) draft.get("verify")).get("ok")).isEqualTo(false);
            org.assertj.core.api.Assertions.assertThat(String.valueOf(
                ((java.util.List<?>) ((Map<?, ?>) draft.get("verify")).get("reasons")).getFirst()
            )).contains(terminal);
            org.assertj.core.api.Assertions.assertThat(draft).containsEntry("usable", false);
            mockMvc.perform(get("/recorder/requests/{requestId}", generated.requestId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.result.drafts[0].verify.reasons[0]").value("pending verification"));
        }
    }

    @Test
    void draftRunnerStartFailureAlsoReplacesPendingReason() throws Exception {
        String sessionId = bindAndRankSession();
        GeneratedDraft generated = generateDraftWithRequest(sessionId);
        verifyPort.startFailure = new RecorderVerifyException("queue_full", "runner queue full");

        mockMvc.perform(post("/recorder/draft/verify")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"sessionId":"%s","draftId":"draft_0"}
                    """.formatted(sessionId)))
            .andExpect(status().isServiceUnavailable())
            .andExpect(jsonPath("$.error.code").value("queue_full"));

        Map<String, Object> draft = internalDraft(sessionId);
        org.assertj.core.api.Assertions.assertThat(((Map<?, ?>) draft.get("verify")).get("ok")).isEqualTo(false);
        org.assertj.core.api.Assertions.assertThat(String.valueOf(
            ((java.util.List<?>) ((Map<?, ?>) draft.get("verify")).get("reasons")).getFirst()
        )).contains("start");
        org.assertj.core.api.Assertions.assertThat(draft).containsEntry("usable", false);
        mockMvc.perform(get("/recorder/requests/{requestId}", generated.requestId()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.result.drafts[0].verify.reasons[0]").value("pending verification"));
    }

    @Test
    void concurrentOrdinaryVerifyStartsDaemonOnlyOncePerSession() throws Exception {
        String sessionId = bindRankAndInitSession();
        verifyPort.blockStarts();
        verifyPort.allowTerminal = false;
        ExecutorService callers = Executors.newFixedThreadPool(2);
        try {
            Map<String, Object> body = Map.of(
                "sessionId", sessionId,
                "name", "example/search",
                "adapterPath", "/tmp/draft.js"
            );
            CompletableFuture<Integer> first = CompletableFuture.supplyAsync(() -> service.verify(body).status(), callers);
            org.assertj.core.api.Assertions.assertThat(verifyPort.startEntered.await(1, TimeUnit.SECONDS)).isTrue();
            CompletableFuture<Integer> second = CompletableFuture.supplyAsync(() -> service.verify(body).status(), callers);
            Thread.sleep(100);
            verifyPort.releaseStart.countDown();

            org.assertj.core.api.Assertions.assertThat(java.util.List.of(first.get(), second.get()))
                .containsExactlyInAnyOrder(202, 400);
            org.assertj.core.api.Assertions.assertThat(verifyPort.startCalls).hasValue(1);
        } finally {
            verifyPort.releaseStart.countDown();
            callers.shutdownNow();
        }
    }

    @Test
    void cancelWaitsForOrdinaryVerifyAtomicStartSection() throws Exception {
        String sessionId = bindRankAndInitSession();
        verifyPort.blockStarts();
        verifyPort.allowTerminal = false;
        ExecutorService callers = Executors.newFixedThreadPool(2);
        try {
            CompletableFuture<Integer> verify = CompletableFuture.supplyAsync(() -> service.verify(Map.of(
                "sessionId", sessionId,
                "name", "example/search",
                "adapterPath", "/tmp/draft.js"
            )).status(), callers);
            org.assertj.core.api.Assertions.assertThat(verifyPort.startEntered.await(1, TimeUnit.SECONDS)).isTrue();
            CompletableFuture<Integer> cancel = CompletableFuture.supplyAsync(
                () -> service.cancel(Map.of("sessionId", sessionId)).status(), callers
            );
            Thread.sleep(100);
            org.assertj.core.api.Assertions.assertThat(cancel).isNotDone();
            verifyPort.releaseStart.countDown();
            org.assertj.core.api.Assertions.assertThat(verify.get()).isEqualTo(202);
            org.assertj.core.api.Assertions.assertThat(cancel.get()).isEqualTo(200);
        } finally {
            verifyPort.releaseStart.countDown();
            callers.shutdownNow();
        }
    }

    @Test
    void productionSaveRequiresExactVerifiedSourceAndSingleSuccessStaysRanked() throws Exception {
        String sessionId = bindAndRankSession();
        generateDraft(sessionId);

        mockMvc.perform(post("/recorder/save")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{" + "\"sessionId\":\"" + sessionId + "\",\"draftId\":\"draft_0\"}"))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error.code").value("verification_required"));
        org.assertj.core.api.Assertions.assertThat(savePort.publishCalls).hasValue(0);

        String source = verifyGeneratedDraft(sessionId);
        internalDraft(sessionId).put("llmModel", "model-exact");

        mockMvc.perform(post("/recorder/save")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"sessionId":"%s","draftId":"draft_0","source":"export const changed = true;"}
                    """.formatted(sessionId)))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error.code").value("source_changed_after_verify"));
        org.assertj.core.api.Assertions.assertThat(savePort.publishCalls).hasValue(0);

        mockMvc.perform(post("/recorder/save")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"sessionId":"%s","draftId":"draft_0"}
                    """.formatted(sessionId)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.ok").value(true))
            .andExpect(jsonPath("$.data.state").value("ranked"))
            .andExpect(jsonPath("$.data.saved[0].draftId").value("draft_0"))
            .andExpect(jsonPath("$.data.site").value("example_com"))
            .andExpect(jsonPath("$.data.name").value("search"))
            .andExpect(jsonPath("$.data.adapterPath").value("/by/.bycli/clis/example_com/search.js"))
            .andExpect(jsonPath("$.data.reportPath").value("/by/.bycli/sites/example_com/search-report.json"));

        org.assertj.core.api.Assertions.assertThat(savePort.lastSource).isEqualTo(source);
        org.assertj.core.api.Assertions.assertThat(savePort.lastLlmModel).isEqualTo("model-exact");
        org.assertj.core.api.Assertions.assertThat(savePort.lastOverwrite).isFalse();

        mockMvc.perform(post("/recorder/save")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{" + "\"sessionId\":\"" + sessionId
                    + "\",\"draftId\":\"draft_0\",\"overwrite\":true}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.state").value("ranked"));
        org.assertj.core.api.Assertions.assertThat(savePort.lastOverwrite).isTrue();
    }

    @Test
    void batchPartialAndAllFailureReturnOrderedResultsWhileAllSuccessCompletesSession() throws Exception {
        String partialSession = preparedTwoDraftSession();
        savePort.failureNames.add("example_com/search_2");

        mockMvc.perform(post("/recorder/save")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"sessionId":"%s","drafts":[{"draftId":"draft_0"},{"draftId":"draft_1"}]}
                    """.formatted(partialSession)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.state").value("ranked"))
            .andExpect(jsonPath("$.data.saved[0].draftId").value("draft_0"))
            .andExpect(jsonPath("$.data.failed[0].draftId").value("draft_1"))
            .andExpect(jsonPath("$.data.failed[0].code").value("daemon_unavailable"))
            .andExpect(jsonPath("$.data.allSucceeded").value(false));

        savePort.failureNames.clear();
        savePort.failureNames.add("example_com/search");
        savePort.failureNames.add("example_com/search_2");
        mockMvc.perform(post("/recorder/save")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"sessionId":"%s","drafts":[{"draftId":"draft_1"},{"draftId":"draft_0"}]}
                    """.formatted(partialSession)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.saved").isEmpty())
            .andExpect(jsonPath("$.data.failed[0].draftId").value("draft_1"))
            .andExpect(jsonPath("$.data.failed[1].draftId").value("draft_0"))
            .andExpect(jsonPath("$.data.allSucceeded").value(false));

        savePort.failureNames.clear();
        String successSession = preparedTwoDraftSession();
        mockMvc.perform(post("/recorder/save")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"sessionId":"%s","drafts":[{"draftId":"draft_1"},{"draftId":"draft_0"}]}
                    """.formatted(successSession)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.saved[0].draftId").value("draft_1"))
            .andExpect(jsonPath("$.data.saved[1].draftId").value("draft_0"))
            .andExpect(jsonPath("$.data.failed").isEmpty())
            .andExpect(jsonPath("$.data.allSucceeded").value(true))
            .andExpect(jsonPath("$.data.state").value("done"));

        mockMvc.perform(post("/recorder/save")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{" + "\"sessionId\":\"" + successSession + "\",\"draftId\":\"draft_0\"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("invalid_state"));
    }

    @Test
    void disabledAndInvalidSelectionsHaveNoPublishSideEffects() throws Exception {
        String sessionId = bindAndRankSession();
        generateDraft(sessionId);
        saveProperties.setProductionEnabled(false);
        mockMvc.perform(post("/recorder/save")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{" + "\"sessionId\":\"" + sessionId + "\",\"draftId\":\"draft_0\"}"))
            .andExpect(status().isServiceUnavailable())
            .andExpect(jsonPath("$.error.code").value("save_adapter_disabled"));
        org.assertj.core.api.Assertions.assertThat(savePort.publishCalls).hasValue(0);

        saveProperties.setProductionEnabled(true);
        for (String draftsJson : java.util.List.of(
            "null",
            "[]",
            "[null]",
            "[{\"draftId\":\"missing\"}]",
            "[{\"draftId\":\"draft_0\"},{\"draftId\":\"draft_0\"}]"
        )) {
            mockMvc.perform(post("/recorder/save")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"sessionId\":\"%s\",\"drafts\":%s}".formatted(sessionId, draftsJson)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("validation_failed"));
        }
        for (String body : java.util.List.of(
            "{\"sessionId\":\"%s\",\"draftId\":\"draft_0\",\"source\":42}".formatted(sessionId),
            "{\"sessionId\":\"%s\",\"draftId\":\"draft_0\",\"overwrite\":\"yes\"}".formatted(sessionId),
            "{\"sessionId\":\"%s\",\"draftId\":\"draft_0\",\"drafts\":[{\"draftId\":\"draft_0\"}]}".formatted(sessionId)
        )) {
            mockMvc.perform(post("/recorder/save").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("validation_failed"));
        }
        org.assertj.core.api.Assertions.assertThat(savePort.publishCalls).hasValue(0);
    }

    @Test
    void singleSaveMapsStableErrorsAndDoesNotExposeInternalMessages() throws Exception {
        String sessionId = bindAndRankSession();
        generateDraft(sessionId);
        verifyGeneratedDraft(sessionId);

        for (Map.Entry<String, Integer> failure : Map.of(
            "validation_failed", 400,
            "adapter_exists", 409,
            "daemon_protocol_error", 502,
            "daemon_unavailable", 503,
            "bycli_storage_unavailable", 503,
            "daemon_timeout", 504
        ).entrySet()) {
            savePort.failureCode = failure.getKey();
            mockMvc.perform(post("/recorder/save")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"sessionId\":\"%s\",\"draftId\":\"draft_0\"}".formatted(sessionId)))
                .andExpect(status().is(failure.getValue()))
                .andExpect(jsonPath("$.error.code").value(failure.getKey()))
                .andExpect(content().string(org.hamcrest.Matchers.not(containsString("secret transport body"))));
        }

        savePort.failureCode = "adapter_exists";
        mockMvc.perform(post("/recorder/save")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"sessionId\":\"%s\",\"draftId\":\"draft_0\"}".formatted(sessionId)))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error.code").value("adapter_exists"))
            .andExpect(jsonPath("$.error.details.adapterPath")
                .value("/by/.bycli/clis/example_com/search.js"))
            .andExpect(content().string(org.hamcrest.Matchers.not(containsString("secret transport body"))));

        savePort.failureCode = null;
    }

    @Test
    void singleSaveSerializesConcurrentReverifyThenAllowsItFromRanked() throws Exception {
        String sessionId = bindAndRankSession();
        generateDraft(sessionId);
        String savedSource = verifyGeneratedDraft(sessionId);
        String editedSource = "export const concurrentlyEdited = true;";
        savePort.blockPublishes();
        ExecutorService callers = Executors.newFixedThreadPool(2);
        try {
            CompletableFuture<RecorderResponse<Map<String, Object>>> save = CompletableFuture.supplyAsync(() -> {
                loginAs(1L, "alice");
                try {
                    return service.save(Map.of("sessionId", sessionId, "draftId", "draft_0"));
                } finally {
                    CurrentUserHolder.clearLoginInfo();
                }
            }, callers);
            org.assertj.core.api.Assertions.assertThat(savePort.publishEntered.await(1, TimeUnit.SECONDS)).isTrue();
            CountDownLatch reverifyStarted = new CountDownLatch(1);
            CompletableFuture<RecorderResponse<Map<String, Object>>> reverify = CompletableFuture.supplyAsync(() -> {
                loginAs(1L, "alice");
                reverifyStarted.countDown();
                try {
                    return service.draftVerify(Map.of(
                        "sessionId", sessionId, "draftId", "draft_0", "source", editedSource
                    ));
                } finally {
                    CurrentUserHolder.clearLoginInfo();
                }
            }, callers);
            org.assertj.core.api.Assertions.assertThat(reverifyStarted.await(1, TimeUnit.SECONDS)).isTrue();
            org.assertj.core.api.Assertions.assertThat(reverify).isNotDone();

            savePort.releasePublish.countDown();
            org.assertj.core.api.Assertions.assertThat(save.get(2, TimeUnit.SECONDS).status()).isEqualTo(200);
            RecorderResponse<Map<String, Object>> verify = reverify.get(2, TimeUnit.SECONDS);
            org.assertj.core.api.Assertions.assertThat(verify.status()).isEqualTo(202);
            awaitRequestStatus(verify.body().requestId(), "succeeded");
            org.assertj.core.api.Assertions.assertThat(savePort.lastSource).isEqualTo(savedSource);
            org.assertj.core.api.Assertions.assertThat(internalDraft(sessionId))
                .containsEntry("source", editedSource)
                .containsEntry("verifiedSourceHash", RecorderPipelineService.sha256(editedSource));
        } finally {
            savePort.releasePublish.countDown();
            callers.shutdownNow();
        }
    }

    @Test
    void successfulBatchCompletesBeforeWaitingGenerateAndReverifyCanMutateDrafts() throws Exception {
        String sessionId = preparedTwoDraftSession();
        List<Map<String, Object>> draftsBeforeSave = sessionRegistry.get(sessionId).orElseThrow().drafts();
        int verifyStartsBeforeSave = verifyPort.startCalls.get();
        savePort.blockPublishes();
        ExecutorService callers = Executors.newFixedThreadPool(3);
        try {
            CompletableFuture<RecorderResponse<Map<String, Object>>> save = CompletableFuture.supplyAsync(() -> {
                loginAs(1L, "alice");
                try {
                    return service.save(Map.of(
                        "sessionId", sessionId,
                        "drafts", List.of(Map.of("draftId", "draft_0"), Map.of("draftId", "draft_1"))
                    ));
                } finally {
                    CurrentUserHolder.clearLoginInfo();
                }
            }, callers);
            org.assertj.core.api.Assertions.assertThat(savePort.publishEntered.await(1, TimeUnit.SECONDS)).isTrue();
            CountDownLatch mutatorsStarted = new CountDownLatch(2);
            CompletableFuture<RecorderResponse<Map<String, Object>>> regenerate = CompletableFuture.supplyAsync(() -> {
                loginAs(1L, "alice");
                mutatorsStarted.countDown();
                try {
                    return service.pipelineGenerate(Map.of("sessionId", sessionId));
                } finally {
                    CurrentUserHolder.clearLoginInfo();
                }
            }, callers);
            CompletableFuture<RecorderResponse<Map<String, Object>>> reverify = CompletableFuture.supplyAsync(() -> {
                loginAs(1L, "alice");
                mutatorsStarted.countDown();
                try {
                    return service.draftVerify(Map.of("sessionId", sessionId, "draftId", "draft_0"));
                } finally {
                    CurrentUserHolder.clearLoginInfo();
                }
            }, callers);
            org.assertj.core.api.Assertions.assertThat(mutatorsStarted.await(1, TimeUnit.SECONDS)).isTrue();
            org.assertj.core.api.Assertions.assertThat(regenerate).isNotDone();
            org.assertj.core.api.Assertions.assertThat(reverify).isNotDone();

            savePort.releasePublish.countDown();
            RecorderResponse<Map<String, Object>> result = save.get(2, TimeUnit.SECONDS);
            org.assertj.core.api.Assertions.assertThat(result.status()).isEqualTo(200);
            org.assertj.core.api.Assertions.assertThat(result.body().data())
                .containsEntry("allSucceeded", true)
                .containsEntry("state", "done");
            org.assertj.core.api.Assertions.assertThat(regenerate.get(2, TimeUnit.SECONDS).status()).isEqualTo(400);
            org.assertj.core.api.Assertions.assertThat(reverify.get(2, TimeUnit.SECONDS).status()).isEqualTo(400);
            org.assertj.core.api.Assertions.assertThat(sessionRegistry.get(sessionId).orElseThrow().state().wireValue())
                .isEqualTo("done");
            org.assertj.core.api.Assertions.assertThat(sessionRegistry.get(sessionId).orElseThrow().drafts())
                .isSameAs(draftsBeforeSave);
            org.assertj.core.api.Assertions.assertThat(verifyPort.startCalls).hasValue(verifyStartsBeforeSave);
        } finally {
            savePort.releasePublish.countDown();
            callers.shutdownNow();
        }
    }

    @Test
    void analyzeUsesAsyncRequestEnvelope() throws Exception {
        MvcResult bind = mockMvc.perform(post("/recorder/session/bind")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"mode":"bind_existing_page"}
                    """))
            .andExpect(status().isOk())
            .andReturn();
        String sessionId = JsonTestValue.readString(bind, "$.data.sessionId");
        mockMvc.perform(post("/recorder/navigate")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"sessionId":"%s","url":"https://example.com"}
                    """.formatted(sessionId)))
            .andExpect(status().isOk());

        MvcResult accepted = mockMvc.perform(post("/recorder/analyze")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"sessionId":"%s","url":"https://example.com"}
                    """.formatted(sessionId)))
            .andExpect(status().isAccepted())
            .andExpect(jsonPath("$.data.type").value("analyze"))
            .andReturn();

        String requestId = JsonTestValue.readString(accepted, "$.requestId");
        mockMvc.perform(get("/recorder/requests/{requestId}", requestId))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.status").value("succeeded"))
            .andExpect(jsonPath("$.data.result.finalUrl").value("https://example.com"));
    }

    @Test
    void missingBindModeReturnsRecorderErrorEnvelope() throws Exception {
        mockMvc.perform(post("/recorder/session/bind")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {}
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.ok").value(false))
            .andExpect(jsonPath("$.error.code").value("validation_failed"))
            .andExpect(jsonPath("$.error.message").value("invalid bind mode"));
    }

    @Test
    void missingSessionReturnsRecorderErrorEnvelope() throws Exception {
        mockMvc.perform(post("/recorder/navigate")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"url":"https://example.com"}
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.ok").value(false))
            .andExpect(jsonPath("$.data").doesNotExist())
            .andExpect(jsonPath("$.error.code").value("validation_failed"))
            .andExpect(jsonPath("$.error.message").value("sessionId required"));
    }

    @Test
    void stateMachineRejectsOutOfOrderActions() throws Exception {
        MvcResult bind = mockMvc.perform(post("/recorder/session/bind")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"mode":"bind_existing_page"}
                    """))
            .andExpect(status().isOk())
            .andReturn();
        String sessionId = JsonTestValue.readString(bind, "$.data.sessionId");

        mockMvc.perform(post("/recorder/rank")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"sessionId":"%s"}
                    """.formatted(sessionId)))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.ok").value(false))
            .andExpect(jsonPath("$.error.code").value("invalid_state"));

        mockMvc.perform(post("/recorder/pipeline/score")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"sessionId":"%s","llmEgressAcknowledgedAt":1760000000000}
                    """.formatted(sessionId)))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("invalid_state"));
    }

    @Test
    void cancelMarksSessionTerminalAndUnknownRequestsReturn404() throws Exception {
        MvcResult bind = mockMvc.perform(post("/recorder/session/bind")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"mode":"bind_existing_page"}
                    """))
            .andExpect(status().isOk())
            .andReturn();
        String sessionId = JsonTestValue.readString(bind, "$.data.sessionId");

        mockMvc.perform(get("/recorder/requests/missing-request"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.ok").value(false))
            .andExpect(jsonPath("$.error.code").value("request_not_found"));

        mockMvc.perform(post("/recorder/cancel")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"sessionId":"%s","scope":"session"}
                    """.formatted(sessionId)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.cancelled").value(true));

        mockMvc.perform(post("/recorder/navigate")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"sessionId":"%s","url":"https://example.com"}
                    """.formatted(sessionId)))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("invalid_state"));
    }

    private String bindAndRankSession() throws Exception {
        MvcResult bind = mockMvc.perform(post("/recorder/session/bind")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"mode":"bind_existing_page"}
                    """))
            .andExpect(status().isOk())
            .andReturn();
        String sessionId = JsonTestValue.readString(bind, "$.data.sessionId");
        captureSample(sessionId, "A", "https://example.com/search?q=alpha", "alpha");
        captureSample(sessionId, "B", "https://example.com/search?q=beta", "beta");
        mockMvc.perform(post("/recorder/rank")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"sessionId":"%s"}
                    """.formatted(sessionId)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.candidates[0].id").value("cand_example_com_search"));
        return sessionId;
    }

    private String bindRankAndInitSession() throws Exception {
        String sessionId = bindAndRankSession();
        mockMvc.perform(post("/recorder/init")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"sessionId":"%s","name":"example/search","selectedCandidateId":"cand_example_com_search","writePolicy":"write"}
                    """.formatted(sessionId)))
            .andExpect(status().isOk());
        return sessionId;
    }

    private String generateDraft(String sessionId) throws Exception {
        return generateDraftWithRequest(sessionId).path();
    }

    private GeneratedDraft generateDraftWithRequest(String sessionId) throws Exception {
        MvcResult generated = mockMvc.perform(post("/recorder/pipeline/generate")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"sessionId":"%s","llmEgressAcknowledgedAt":1760000000000}
                    """.formatted(sessionId)))
            .andExpect(status().isAccepted())
            .andReturn();
        String requestId = JsonTestValue.readString(generated, "$.requestId");
        MvcResult result = mockMvc.perform(get("/recorder/requests/{requestId}", requestId))
            .andExpect(status().isOk())
            .andReturn();
        return new GeneratedDraft(
            requestId,
            ((RecorderBycliPaths) internalDraft(sessionId).get("verificationPaths")).backendPath().toString()
        );
    }

    private String verifyGeneratedDraft(String sessionId) throws Exception {
        String source = String.valueOf(internalDraft(sessionId).get("source"));
        MvcResult accepted = mockMvc.perform(post("/recorder/draft/verify")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"sessionId":"%s","draftId":"draft_0"}
                    """.formatted(sessionId)))
            .andExpect(status().isAccepted())
            .andReturn();
        awaitRequestStatus(JsonTestValue.readString(accepted, "$.requestId"), "succeeded");
        return source;
    }

    private String preparedTwoDraftSession() throws Exception {
        String sessionId = bindAndRankSession();
        generateDraft(sessionId);
        verifyGeneratedDraft(sessionId);
        Map<String, Object> first = internalDraft(sessionId);
        Map<String, Object> second = new java.util.LinkedHashMap<>(first);
        second.put("id", "draft_1");
        second.put("name", "search_2");
        sessionRegistry.get(sessionId).orElseThrow().drafts().add(second);
        return sessionId;
    }

    private Map<String, Object> internalDraft(String sessionId) {
        return sessionRegistry.get(sessionId).orElseThrow().drafts().getFirst();
    }

    private org.springframework.test.web.servlet.ResultActions awaitRequestStatus(String requestId, String expected) throws Exception {
        long deadline = System.nanoTime() + Duration.ofSeconds(2).toNanos();
        MvcResult result = null;
        while (System.nanoTime() < deadline) {
            result = mockMvc.perform(get("/recorder/requests/{requestId}", requestId)).andReturn();
            String status = JsonTestValue.readString(result, "$.data.status");
            if (expected.equals(status)) {
                return mockMvc.perform(get("/recorder/requests/{requestId}", requestId));
            }
            Thread.sleep(10);
        }
        throw new AssertionError("request did not reach " + expected + ": " + (result == null ? "none" : result.getResponse().getContentAsString()));
    }

    private void captureSample(String sessionId, String sampleName, String url, String seed) throws Exception {
        mockMvc.perform(post("/recorder/navigate")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"sessionId":"%s","url":"%s"}
                    """.formatted(sessionId, url)))
            .andExpect(status().isOk());
        mockMvc.perform(post("/recorder/capture/start")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"sessionId":"%s","sampleName":"%s","trigger":"user_manual"}
                    """.formatted(sessionId, sampleName)))
            .andExpect(status().isOk());
        mockMvc.perform(post("/recorder/capture/read")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"sessionId":"%s","sampleName":"%s","seed":"%s"}
                    """.formatted(sessionId, sampleName, seed)))
            .andExpect(status().isOk());
    }

    private void loginAs(long userId, String userCode) {
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(userId);
        loginInfo.setUserCode(userCode);
        CurrentUserHolder.setLoginInfo(loginInfo);
    }

    private static final class FakeVncProvider implements RecorderVncProvider {
        private final AtomicInteger stopCalls = new AtomicInteger();

        @Override
        public RecorderVncEndpoint start(String sessionId) {
            return new RecorderVncEndpoint(
                "managed",
                "http://127.0.0.1:16080/vnc.html",
                "127.0.0.1",
                17000,
                "bycli-vnc-test",
                16080
            );
        }

        @Override
        public void stop(String sessionId) {
            stopCalls.incrementAndGet();
        }

        @Override
        public void stopAll() {
        }
    }

    private static final class FakeVerifyPort implements RecorderVerifyPort {
        private volatile boolean allowTerminal = true;
        private volatile RecorderVerifyException startFailure;
        private volatile String canonicalRequestId;
        private volatile String adapterPath;
        private volatile String expectedSourceSha256;
        private volatile String terminalStatus = "succeeded";
        private final AtomicInteger startCalls = new AtomicInteger();
        private volatile CountDownLatch startEntered = new CountDownLatch(0);
        private volatile CountDownLatch releaseStart = new CountDownLatch(0);

        private void blockStarts() {
            startEntered = new CountDownLatch(1);
            releaseStart = new CountDownLatch(1);
        }

        @Override
        public String start(
            String canonicalRequestId,
            String sessionId,
            String name,
            String adapterPath,
            Map<String, Object> executionSeedArgs
        ) {
            return start(canonicalRequestId, sessionId, name, adapterPath, null, executionSeedArgs);
        }

        @Override
        public String start(
            String canonicalRequestId,
            String sessionId,
            String name,
            String adapterPath,
            String expectedSourceSha256,
            Map<String, Object> executionSeedArgs
        ) {
            startCalls.incrementAndGet();
            startEntered.countDown();
            try {
                releaseStart.await();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new RecorderVerifyException("daemon_unavailable", "start interrupted");
            }
            this.canonicalRequestId = canonicalRequestId;
            this.adapterPath = adapterPath;
            this.expectedSourceSha256 = expectedSourceSha256;
            if (startFailure != null) {
                throw startFailure;
            }
            return canonicalRequestId;
        }

        @Override
        public Map<String, Object> status(String daemonRequestId) {
            if (!allowTerminal) {
                return Map.of("status", "running");
            }
            if (!"succeeded".equals(terminalStatus)) {
                return Map.of(
                    "status", terminalStatus,
                    "error", Map.of("code", "verify_" + terminalStatus, "message", "runner " + terminalStatus)
                );
            }
            Map<String, Object> result = new java.util.LinkedHashMap<>();
            result.put("ok", true);
            result.put("stage", "execute");
            result.put("rows", 2);
            result.put("fieldCount", 3);
            if (expectedSourceSha256 != null) {
                result.put("sourceSha256", expectedSourceSha256);
            }
            return Map.of("status", "succeeded", "result", result);
        }
    }

    private static final class FakeSavePort implements RecorderSavePort {
        private final AtomicInteger publishCalls = new AtomicInteger();
        private final java.util.Set<String> failureNames = java.util.concurrent.ConcurrentHashMap.newKeySet();
        private volatile String failureCode;
        private volatile String lastSource;
        private volatile String lastLlmModel;
        private volatile boolean lastOverwrite;
        private volatile CountDownLatch publishEntered = new CountDownLatch(0);
        private volatile CountDownLatch releasePublish = new CountDownLatch(0);

        private void blockPublishes() {
            publishEntered = new CountDownLatch(1);
            releasePublish = new CountDownLatch(1);
        }

        @Override
        public PublishResult publish(
            com.iwhalecloud.byai.state.domain.recorder.model.RecorderOwner owner,
            String name,
            String source,
            String llmModel,
            boolean overwrite
        ) {
            publishCalls.incrementAndGet();
            publishEntered.countDown();
            try {
                releasePublish.await();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new com.iwhalecloud.byai.state.application.service.recorder.RecorderSaveException(
                    "daemon_unavailable", "publish interrupted", e
                );
            }
            lastSource = source;
            lastLlmModel = llmModel;
            lastOverwrite = overwrite;
            if (failureCode != null || failureNames.contains(name)) {
                if ("adapter_exists".equals(failureCode)) {
                    throw new com.iwhalecloud.byai.state.application.service.recorder.RecorderSaveException(
                        "adapter_exists",
                        "secret transport body",
                        Map.of("adapterPath", "/by/.bycli/clis/" + name + ".js")
                    );
                }
                throw new com.iwhalecloud.byai.state.application.service.recorder.RecorderSaveException(
                    failureCode == null ? "daemon_unavailable" : failureCode,
                    "secret transport body"
                );
            }
            return new PublishResult(
                "/by/.bycli/clis/" + name + ".js",
                "/by/.bycli/sites/" + name + "-report.json"
            );
        }
    }

    private record GeneratedDraft(String requestId, String path) {
    }
}
