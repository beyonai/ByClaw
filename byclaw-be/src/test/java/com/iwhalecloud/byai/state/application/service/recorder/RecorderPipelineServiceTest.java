package com.iwhalecloud.byai.state.application.service.recorder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.iwhalecloud.byai.state.domain.recorder.model.RecorderSession;
import com.iwhalecloud.byai.state.domain.recorder.model.RecorderOwner;
import com.iwhalecloud.byai.state.domain.recorder.model.RecorderSessionState;
import java.nio.file.Path;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.function.BiConsumer;
import java.util.function.Function;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class RecorderPipelineServiceTest {

    @TempDir
    Path tempDir;

    @Test
    void delayedVerifyCallbacksCannotMutateTerminalSessionDrafts() {
        CapturingVerifyService verifyService = new CapturingVerifyService();
        RecorderPipelineService pipeline = pipeline(verifyService);
        RecorderSession session = new RecorderSession("session-1", new RecorderOwner(1L, "alice"));
        Map<String, Object> draft = draft();
        session.drafts(new ArrayList<>(List.of(draft)));

        assertThat(pipeline.verifyDraft(session, "draft_0")).contains("request-1");
        Map<String, Object> pending = new LinkedHashMap<>(draft);
        session.state(RecorderSessionState.DONE);

        verifyService.runs.getFirst().resultMapper().apply(Map.of(
            "ok", true,
            "stage", "execute",
            "rows", 2,
            "fieldCount", 3,
            "sourceSha256", RecorderPipelineService.sha256(String.valueOf(draft.get("source")))
        ));
        verifyService.runs.getFirst().terminalObserver().accept("failed", Map.of());

        assertThat(draft).isEqualTo(pending).doesNotContainKeys("verifiedSourceHash", "verifiedAt");
    }

    @Test
    void activeDraftVerifyRejectsDuplicatesAndStaleCallbacksCannotOverwriteCurrentRun() {
        CapturingVerifyService verifyService = new CapturingVerifyService();
        RecorderPipelineService pipeline = pipeline(verifyService);
        RecorderSession session = new RecorderSession("session-1", new RecorderOwner(1L, "alice"));
        Map<String, Object> draft = draft();
        session.drafts(new ArrayList<>(List.of(draft)));

        assertThat(pipeline.verifyDraft(session, "draft_0", "export const first = true;")).contains("request-1");
        assertThat(draft).doesNotContainKeys("verifiedSourceHash", "verifiedAt");
        assertThatThrownBy(() -> pipeline.verifyDraft(session, "draft_0"))
            .isInstanceOf(RecorderVerifyException.class)
            .hasFieldOrPropertyWithValue("code", "invalid_state")
            .hasMessageContaining("already being verified");
        assertThat(verifyService.startCalls).isEqualTo(1);
        assertThat(pipeline.publicDrafts(List.of(draft)).getFirst().keySet())
            .noneMatch(key -> key.toLowerCase().contains("active"));
        verifyService.runs.get(0).terminalObserver().accept("failed", Map.of());
        Map<String, Object> firstFailure = new LinkedHashMap<>(map(draft.get("verify")));

        assertThat(pipeline.verifyDraft(session, "draft_0", "export const second = true;")).contains("request-2");
        Map<String, Object> secondPending = new LinkedHashMap<>(map(draft.get("verify")));
        verifyService.runs.get(0).resultMapper().apply(Map.of(
            "ok", true,
            "stage", "execute",
            "rows", 2,
            "fieldCount", 3,
            "sourceSha256", RecorderPipelineService.sha256("export const first = true;")
        ));
        assertThat(draft).doesNotContainKeys("verifiedSourceHash", "verifiedAt");
        verifyService.runs.get(0).terminalObserver().accept("failed", Map.of());
        assertThat(map(draft.get("verify"))).isEqualTo(secondPending).isNotEqualTo(firstFailure);

        verifyService.runs.get(1).resultMapper().apply(Map.of(
            "ok", true,
            "stage", "execute",
            "rows", 2,
            "fieldCount", 3,
            "sourceSha256", RecorderPipelineService.sha256("export const second = true;")
        ));
        verifyService.runs.get(1).terminalObserver().accept("succeeded", Map.of());
        verifyService.runs.get(0).terminalObserver().accept("failed", Map.of());

        assertThat(map(draft.get("verify"))).containsEntry("ok", true);
        assertThat(draft)
            .containsEntry("usable", true)
            .containsEntry("verifiedSourceHash", RecorderPipelineService.sha256("export const second = true;"))
            .containsKey("verifiedAt");
    }

    @Test
    void verifiesExactEditedSourceAndClearsHashAfterFailure() throws Exception {
        CapturingVerifyService verifyService = new CapturingVerifyService();
        RecorderPipelineService pipeline = pipeline(verifyService);
        RecorderSession session = new RecorderSession("session-1", new RecorderOwner(1L, "alice"));
        Map<String, Object> draft = draft();
        draft.put("verifiedSourceHash", "stale-hash");
        draft.put("verifiedAt", 123L);
        session.drafts(new ArrayList<>(List.of(draft)));
        String edited = "export const edited = true;\n";

        assertThat(pipeline.verifyDraft(session, "draft_0", edited)).contains("request-1");
        assertThat(draft)
            .containsEntry("source", edited)
            .containsEntry("usable", false)
            .doesNotContainKeys("verifiedSourceHash", "verifiedAt");
        assertThat(Files.readString(tempDir.resolve(
            "byclaw-alice/by/.bycli/.recorder-drafts/session-1/draft_0.js"
        ))).isEqualTo(edited);
        assertThat(verifyService.adapterPath)
            .isEqualTo("/by/.bycli/.recorder-drafts/session-1/draft_0.js");

        Map<String, Object> result = verifyService.runs.getFirst().resultMapper().apply(Map.of(
            "ok", true,
            "stage", "execute",
            "rows", 1,
            "fieldCount", 2,
            "sourceSha256", RecorderPipelineService.sha256(edited)
        ));
        assertThat(result)
            .containsEntry("verifiedSourceHash", RecorderPipelineService.sha256(edited));
        assertThat(draft)
            .containsEntry("verifiedSourceHash", RecorderPipelineService.sha256(edited))
            .containsKey("verifiedAt");

        assertThat(pipeline.verifyDraft(session, "draft_0")).contains("request-2");
        verifyService.runs.get(1).terminalObserver().accept("timeout", Map.of());
        assertThat(draft)
            .containsEntry("usable", false)
            .doesNotContainKeys("verifiedSourceHash", "verifiedAt");
    }

    @Test
    void verifiedSourceBoundaryRejectsMissingAndChangedVerification() {
        RecorderPipelineService pipeline = pipeline(new CapturingVerifyService());
        Map<String, Object> draft = draft();
        draft.put("staticOk", true);

        assertThatThrownBy(() -> pipeline.requireVerifiedSource(draft, null))
            .isInstanceOf(RecorderSaveException.class)
            .hasFieldOrPropertyWithValue("code", "verification_required");

        String source = String.valueOf(draft.get("source"));
        draft.put("verify", Map.of("ok", true));
        draft.put("usable", true);
        draft.put("verifiedSourceHash", RecorderPipelineService.sha256(source));
        assertThat(pipeline.requireVerifiedSource(draft, null)).isEqualTo(source);

        assertThatThrownBy(() -> pipeline.requireVerifiedSource(draft, source + "\nchanged"))
            .isInstanceOf(RecorderSaveException.class)
            .hasFieldOrPropertyWithValue("code", "source_changed_after_verify");
    }

    @Test
    void daemonResultMustContainTheExpectedLowercaseSourceHash() {
        CapturingVerifyService verifyService = new CapturingVerifyService();
        RecorderPipelineService pipeline = pipeline(verifyService);
        RecorderSession session = new RecorderSession("session-1", new RecorderOwner(1L, "alice"));
        Map<String, Object> draft = draft();
        session.drafts(new ArrayList<>(List.of(draft)));
        String source = String.valueOf(draft.get("source"));
        String expected = RecorderPipelineService.sha256(source);

        assertThat(pipeline.verifyDraft(session, "draft_0")).contains("request-1");
        assertThat(verifyService.expectedSourceSha256).isEqualTo(expected);
        for (Object actual : List.of("", "A".repeat(64), "b".repeat(64))) {
            Map<String, Object> summary = new LinkedHashMap<>();
            summary.put("ok", true);
            summary.put("stage", "execute");
            summary.put("rows", 1);
            summary.put("fieldCount", 1);
            if (!"".equals(actual)) {
                summary.put("sourceSha256", actual);
            }
            Map<String, Object> result = verifyService.runs.getFirst().resultMapper().apply(summary);
            assertThat(result).containsEntry("usable", false).doesNotContainKey("verifiedSourceHash");
            assertThat(draft).containsEntry("usable", false).doesNotContainKeys("verifiedSourceHash", "verifiedAt");
        }
    }

    @Test
    void sourceValidationRunsBeforeHashWriteAndDaemonStart() {
        CapturingVerifyService verifyService = new CapturingVerifyService();
        RecorderPipelineService pipeline = pipeline(verifyService);
        RecorderSession session = new RecorderSession("session-1", new RecorderOwner(1L, "alice"));
        session.drafts(new ArrayList<>(List.of(draft())));
        Path stored = tempDir.resolve("byclaw-alice/by/.bycli/.recorder-drafts/session-1/draft_0.js");

        for (String invalid : List.of(
            "   \n",
            "x".repeat(RecorderPipelineService.MAX_SOURCE_BYTES + 1),
            "界".repeat(RecorderPipelineService.MAX_SOURCE_BYTES / 3 + 1)
        )) {
            assertThatThrownBy(() -> pipeline.verifyDraft(session, "draft_0", invalid))
                .isInstanceOf(RecorderVerifyException.class)
                .hasFieldOrPropertyWithValue("code", "validation_failed")
                .hasMessage("adapter source must be nonblank and at most 1048576 UTF-8 bytes");
            assertThat(stored).doesNotExist();
            assertThat(verifyService.startCalls).isZero();
        }

        String boundary = "界".repeat((RecorderPipelineService.MAX_SOURCE_BYTES - 1) / 3) + "x";
        assertThat(boundary.getBytes(StandardCharsets.UTF_8)).hasSize(RecorderPipelineService.MAX_SOURCE_BYTES);
        assertThat(pipeline.verifyDraft(session, "draft_0", boundary)).contains("request-1");
        assertThat(stored).exists();
        assertThat(verifyService.startCalls).isEqualTo(1);
    }

    @Test
    void startFailureReleasesDraftVerifyGuard() {
        CapturingVerifyService verifyService = new CapturingVerifyService();
        RecorderPipelineService pipeline = pipeline(verifyService);
        RecorderSession session = new RecorderSession("session-1", new RecorderOwner(1L, "alice"));
        session.drafts(new ArrayList<>(List.of(draft())));
        verifyService.startFailure = new RecorderVerifyException("queue_full", "runner queue full");
        Map<String, Object> draft = session.drafts().getFirst();
        draft.put("verifiedSourceHash", "old-hash");
        draft.put("verifiedAt", 123L);
        draft.put("verify", Map.of("ok", true));
        draft.put("usable", true);

        assertThatThrownBy(() -> pipeline.verifyDraft(session, "draft_0"))
            .isInstanceOf(RecorderVerifyException.class)
            .hasFieldOrPropertyWithValue("code", "queue_full");
        assertThat(draft).containsEntry("usable", false).doesNotContainKeys("verifiedSourceHash", "verifiedAt");
        assertThat(map(draft.get("verify")))
            .containsEntry("ok", false)
            .satisfies(entry -> assertThat(String.valueOf(entry.get("reasons"))).contains("start"));

        verifyService.startFailure = null;
        assertThat(pipeline.verifyDraft(session, "draft_0")).contains("request-2");
        assertThat(verifyService.startCalls).isEqualTo(2);
    }

    @Test
    void storageFailureLeavesFailedVerificationAndInvalidatesOldHash() {
        RecorderDraftStore failingStore = new RecorderDraftStore(new RecorderBycliPathResolver(tempDir)) {
            @Override
            public RecorderBycliPaths write(RecorderOwner owner, String sessionId, String draftId, String source) {
                throw new RecorderSaveException("bycli_storage_unavailable", "storage unavailable");
            }
        };
        CapturingVerifyService verifyService = new CapturingVerifyService();
        RecorderPipelineService pipeline = new RecorderPipelineService(failingStore, verifyService);
        RecorderSession session = new RecorderSession("session-1", new RecorderOwner(1L, "alice"));
        Map<String, Object> draft = draft();
        draft.put("verifiedSourceHash", "old-hash");
        draft.put("verifiedAt", 123L);
        draft.put("verify", Map.of("ok", true));
        draft.put("usable", true);
        session.drafts(new ArrayList<>(List.of(draft)));

        assertThatThrownBy(() -> pipeline.verifyDraft(session, "draft_0", "export const next = true;"))
            .isInstanceOf(RecorderSaveException.class)
            .hasFieldOrPropertyWithValue("code", "bycli_storage_unavailable");
        assertThat(draft).containsEntry("usable", false).doesNotContainKeys("verifiedSourceHash", "verifiedAt");
        assertThat(map(draft.get("verify")))
            .containsEntry("ok", false)
            .satisfies(entry -> assertThat(String.valueOf(entry.get("reasons"))).contains("write"));
        assertThat(verifyService.startCalls).isZero();
    }

    private Map<String, Object> draft() {
        Map<String, Object> draft = new LinkedHashMap<>();
        draft.put("id", "draft_0");
        draft.put("site", "example_com");
        draft.put("name", "search");
        draft.put("source", "export const original = true;");
        draft.put("verificationPaths", new RecorderBycliPaths(
            tempDir.resolve("draft.js"),
            Path.of("/by/.bycli/.recorder-drafts/session-1/draft.js")
        ));
        draft.put("verifyArgs", Map.of());
        draft.put("verifyExpectation", Map.of("minRows", 1, "expectedStage", "execute"));
        draft.put("verify", Map.of("ok", false, "reasons", List.of("pending verification")));
        draft.put("usable", false);
        return draft;
    }

    @Test
    void generatedDraftUsesDaemonPathForVerifyAndDoesNotExposeInternalPaths() {
        CapturingVerifyService verifyService = new CapturingVerifyService();
        RecorderPipelineService pipeline = pipeline(verifyService);
        RecorderSession session = new RecorderSession("session-1", new RecorderOwner(1L, "alice"));
        session.candidates(List.of(Map.of(
            "id", "candidate-1",
            "endpoint", Map.of("host", "example.com", "pathname", "/search")
        )));

        Map<String, Object> response = pipeline.generate(session, List.of());
        Map<String, Object> publicDraft = map(((List<?>) response.get("drafts")).getFirst());
        assertThat(publicDraft)
            .containsEntry("filePath", "clis/example_com/search.js")
            .containsEntry("savePath", "clis/example_com/search.js")
            .doesNotContainKeys("verificationPath", "verificationPaths");
        assertThat(publicDraft.toString()).doesNotContain(tempDir.toString()).doesNotContain("/by/.bycli");

        assertThat(pipeline.verifyDraft(session, "draft_0")).contains("request-1");
        assertThat(verifyService.adapterPath).isEqualTo("/by/.bycli/.recorder-drafts/session-1/draft_0.js");
        assertThat(tempDir.resolve("byclaw-alice/by/.bycli/.recorder-drafts/session-1/draft_0.js")).exists();
    }

    @Test
    void saveSourceUsesTheSameUtf8ValidationBoundaryAsVerification() {
        RecorderPipelineService pipeline = pipeline(new CapturingVerifyService());
        Map<String, Object> draft = draft();
        draft.put("staticOk", true);
        draft.put("verify", Map.of("ok", true));
        draft.put("usable", true);

        for (String invalid : List.of(
            " \n ",
            "x".repeat(RecorderPipelineService.MAX_SOURCE_BYTES + 1),
            "界".repeat(RecorderPipelineService.MAX_SOURCE_BYTES / 3 + 1)
        )) {
            draft.put("verifiedSourceHash", RecorderPipelineService.sha256(invalid));
            assertThatThrownBy(() -> pipeline.requireVerifiedSource(draft, invalid))
                .isInstanceOf(RecorderSaveException.class)
                .hasFieldOrPropertyWithValue("code", "validation_failed")
                .hasMessage("adapter source must be nonblank and at most 1048576 UTF-8 bytes");
        }

        String boundary = "界".repeat((RecorderPipelineService.MAX_SOURCE_BYTES - 1) / 3) + "x";
        draft.put("verifiedSourceHash", RecorderPipelineService.sha256(boundary));
        assertThat(pipeline.requireVerifiedSource(draft, boundary)).isEqualTo(boundary);
    }

    private RecorderPipelineService pipeline(CapturingVerifyService verifyService) {
        return new RecorderPipelineService(
            RecorderDraftStoreTestSupport.forFileRoot(tempDir),
            verifyService
        );
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> map(Object value) {
        return (Map<String, Object>) value;
    }

    private static final class CapturingVerifyService extends RecorderVerifyService {
        private final List<CapturedRun> runs = new ArrayList<>();
        private int startCalls;
        private RecorderVerifyException startFailure;
        private String adapterPath;
        private String expectedSourceSha256;

        private CapturingVerifyService() {
            super(new NoopVerifyPort(), new RecorderRequestRegistry(), Executors.newSingleThreadExecutor(), 1, 0);
        }

        @Override
        public String start(
            String sessionId,
            RecorderOwner owner,
            String type,
            String name,
            String adapterPath,
            String expectedSourceSha256,
            Map<String, Object> executionSeedArgs,
            Function<Map<String, Object>, Map<String, Object>> resultMapper,
            Runnable acceptedCallback,
            BiConsumer<String, Map<String, Object>> terminalObserver
        ) {
            startCalls++;
            this.adapterPath = adapterPath;
            this.expectedSourceSha256 = expectedSourceSha256;
            if (startFailure != null) {
                throw startFailure;
            }
            runs.add(new CapturedRun(resultMapper, terminalObserver));
            return "request-" + startCalls;
        }
    }

    private record CapturedRun(
        Function<Map<String, Object>, Map<String, Object>> resultMapper,
        BiConsumer<String, Map<String, Object>> terminalObserver
    ) {
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
            return Map.of("status", "running");
        }
    }
}
