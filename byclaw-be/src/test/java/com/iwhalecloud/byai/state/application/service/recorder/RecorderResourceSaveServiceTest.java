package com.iwhalecloud.byai.state.application.service.recorder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.state.domain.recorder.model.RecorderOwner;
import com.iwhalecloud.byai.state.domain.recorder.model.RecorderSession;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class RecorderResourceSaveServiceTest {

    private static final RecorderOwner OWNER = new RecorderOwner(42L, "Alice_42");
    private static final String SOURCE = "export default async function main() { return []; }";

    private final RecorderSaveProperties properties = new RecorderSaveProperties();
    private final RecorderPipelineService pipeline = mock(RecorderPipelineService.class);
    private final RecorderSavePort savePort = mock(RecorderSavePort.class);
    private RecorderResourceSaveService service;

    @BeforeEach
    void setUp() {
        properties.setProductionEnabled(true);
        service = new RecorderResourceSaveService(properties, pipeline, savePort);
    }

    @Test
    void disabledFeatureFailsBeforeVerificationOrDaemon() {
        properties.setProductionEnabled(false);

        assertThatThrownBy(() -> service.save(
            OWNER, session(OWNER), verifiedDraft("draft_1", "site", "name"), null, false
        ))
            .isInstanceOf(RecorderSaveException.class)
            .hasFieldOrPropertyWithValue("code", "save_adapter_disabled");

        verify(pipeline, never()).requireVerifiedSource(any(), any());
        verify(savePort, never()).publish(any(), anyString(), anyString(), any(), anyBoolean());
    }

    @Test
    void verifiedSourceIsPublishedWithoutDatabaseIdentity() {
        Map<String, Object> draft = verifiedDraft("draft_1", "example_com", "search");
        when(pipeline.requireVerifiedSource(draft, null)).thenReturn(SOURCE);
        RecorderSavePort.PublishResult published = publishResult("example_com", "search");
        when(savePort.publish(OWNER, "example_com/search", SOURCE, "model-a", false)).thenReturn(published);

        RecorderResourceSaveService.SavedAdapter saved = service.save(
            OWNER, session(OWNER), draft, null, false
        );

        assertThat(saved).isEqualTo(new RecorderResourceSaveService.SavedAdapter(
            "draft_1", "example_com", "search", published.adapterPath(), published.reportPath()
        ));
        verify(savePort).publish(OWNER, "example_com/search", SOURCE, "model-a", false);
    }

    @Test
    void explicitOverwriteIsForwardedOnlyAfterCallerRequestsIt() {
        Map<String, Object> draft = verifiedDraft("draft_1", "site", "name");
        when(pipeline.requireVerifiedSource(draft, SOURCE)).thenReturn(SOURCE);
        when(savePort.publish(OWNER, "site/name", SOURCE, "model-a", true))
            .thenReturn(publishResult("site", "name"));

        service.save(OWNER, session(OWNER), draft, SOURCE, true);

        verify(savePort).publish(OWNER, "site/name", SOURCE, "model-a", true);
    }

    @Test
    void verificationFailureStopsBeforeDaemon() {
        Map<String, Object> draft = verifiedDraft("draft_1", "site", "name");
        when(pipeline.requireVerifiedSource(draft, SOURCE))
            .thenThrow(new RecorderSaveException("source_changed_after_verify", "source changed"));

        assertThatThrownBy(() -> service.save(OWNER, session(OWNER), draft, SOURCE, false))
            .isInstanceOf(RecorderSaveException.class)
            .hasFieldOrPropertyWithValue("code", "source_changed_after_verify");
        verify(savePort, never()).publish(any(), anyString(), anyString(), any(), anyBoolean());
    }

    @Test
    void adapterExistsDetailsPassThroughUnchanged() {
        Map<String, Object> draft = verifiedDraft("draft_1", "site", "name");
        when(pipeline.requireVerifiedSource(draft, null)).thenReturn(SOURCE);
        RecorderSaveException conflict = new RecorderSaveException(
            "adapter_exists",
            "already exists",
            Map.of("adapterPath", "/by/.bycli/clis/site/name.js")
        );
        when(savePort.publish(OWNER, "site/name", SOURCE, "model-a", false)).thenThrow(conflict);

        assertThatThrownBy(() -> service.save(OWNER, session(OWNER), draft, null, false))
            .isSameAs(conflict);
    }

    @Test
    void batchKeepsConflictsIsolatedAndIncludesSafePath() {
        Map<String, Object> existing = verifiedDraft("draft_1", "site", "existing");
        Map<String, Object> created = verifiedDraft("draft_2", "site", "created");
        when(pipeline.requireVerifiedSource(existing, null)).thenReturn(SOURCE);
        when(pipeline.requireVerifiedSource(created, null)).thenReturn(SOURCE);
        when(savePort.publish(OWNER, "site/existing", SOURCE, "model-a", false)).thenThrow(
            new RecorderSaveException(
                "adapter_exists",
                "already exists",
                Map.of("adapterPath", "/by/.bycli/clis/site/existing.js")
            )
        );
        when(savePort.publish(OWNER, "site/created", SOURCE, "model-a", false))
            .thenReturn(publishResult("site", "created"));

        RecorderResourceSaveService.BatchSaveResult result = service.saveMany(
            OWNER,
            session(OWNER),
            List.of(
                new RecorderResourceSaveService.DraftSaveRequest(existing, null, false),
                new RecorderResourceSaveService.DraftSaveRequest(created, null, false)
            )
        );

        assertThat(result.allSucceeded()).isFalse();
        assertThat(result.saved()).extracting(RecorderResourceSaveService.SavedAdapter::draftId)
            .containsExactly("draft_2");
        assertThat(result.failed()).containsExactly(new RecorderResourceSaveService.FailedAdapter(
            "draft_1", "adapter_exists", "already exists", "/by/.bycli/clis/site/existing.js"
        ));
    }

    @Test
    void ownerMismatchAndInvalidDraftIdentityFailClosed() {
        RecorderOwner other = new RecorderOwner(43L, "Bob_43");
        assertThatThrownBy(() -> service.save(
            OWNER, session(other), verifiedDraft("draft_1", "site", "name"), null, false
        ))
            .isInstanceOf(RecorderSaveException.class)
            .hasFieldOrPropertyWithValue("code", "session_not_found");

        Map<String, Object> unsafe = verifiedDraft("draft_1", "../site", "name");
        assertThatThrownBy(() -> service.save(OWNER, session(OWNER), unsafe, null, false))
            .isInstanceOf(RecorderSaveException.class)
            .hasFieldOrPropertyWithValue("code", "validation_failed");
    }

    private static RecorderSavePort.PublishResult publishResult(String site, String name) {
        return new RecorderSavePort.PublishResult(
            "/by/.bycli/clis/" + site + "/" + name + ".js",
            "/by/.bycli/sites/" + site + "/recorder/" + name + "-report.json"
        );
    }

    private static RecorderSession session(RecorderOwner owner) {
        return new RecorderSession("session_1", owner);
    }

    private static Map<String, Object> verifiedDraft(String id, String site, String name) {
        Map<String, Object> draft = new LinkedHashMap<>();
        draft.put("id", id);
        draft.put("site", site);
        draft.put("name", name);
        draft.put("source", SOURCE);
        draft.put("llmModel", "model-a");
        draft.put("staticOk", true);
        draft.put("verify", Map.of("ok", true));
        draft.put("usable", true);
        draft.put("verifiedSourceHash", RecorderPipelineService.sha256(SOURCE));
        return draft;
    }
}
