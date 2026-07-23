package com.iwhalecloud.byai.state.application.service.recorder;

import com.iwhalecloud.byai.state.domain.recorder.model.RecorderEnvelope;
import com.iwhalecloud.byai.state.domain.recorder.model.RecorderError;
import com.iwhalecloud.byai.state.domain.recorder.model.RecorderSession;
import com.iwhalecloud.byai.state.domain.recorder.model.RecorderSessionAction;
import com.iwhalecloud.byai.state.domain.recorder.model.RecorderSessionState;
import com.iwhalecloud.byai.state.domain.recorder.model.RecorderOwner;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.HashSet;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class RecorderApplicationService {

    private static final Logger log = LoggerFactory.getLogger(RecorderApplicationService.class);

    private final RecorderSessionRegistry sessionRegistry;
    private final RecorderRequestRegistry requestRegistry;
    private final RecorderRankService rankService;
    private final RecorderPipelineService pipelineService;
    private final RecorderBrowserPort browserPort;
    private final RecorderVncProvider vncProvider;
    private final RecorderVerifyService verifyService;
    private final RecorderDraftStore draftStore;
    private final RecorderCurrentUserProvider currentUserProvider;
    private final RecorderResourceSaveService resourceSaveService;

    public RecorderApplicationService(
        RecorderSessionRegistry sessionRegistry,
        RecorderRequestRegistry requestRegistry,
        RecorderRankService rankService,
        RecorderPipelineService pipelineService,
        RecorderBrowserPort browserPort,
        RecorderVncProvider vncProvider,
        RecorderVerifyService verifyService,
        RecorderDraftStore draftStore,
        RecorderCurrentUserProvider currentUserProvider,
        RecorderResourceSaveService resourceSaveService
    ) {
        this.sessionRegistry = sessionRegistry;
        this.requestRegistry = requestRegistry;
        this.rankService = rankService;
        this.pipelineService = pipelineService;
        this.browserPort = browserPort;
        this.vncProvider = vncProvider;
        this.verifyService = verifyService;
        this.draftStore = draftStore;
        this.currentUserProvider = currentUserProvider;
        this.resourceSaveService = resourceSaveService;
    }

    public RecorderResponse<Map<String, Object>> health() {
        try {
            return ok(browserPort.health(currentUserProvider.requireCurrent()));
        } catch (RecorderSaveException e) {
            return ok(browserPort.health());
        } catch (RecorderBrowserException e) {
            return fail(e.getHttpStatus(), e.getCode(), e.getMessage());
        }
    }

    public RecorderResponse<Map<String, Object>> bind(Map<String, Object> body) {
        RecorderOwner owner;
        try {
            owner = currentUserProvider.requireCurrent();
        } catch (RecorderSaveException e) {
            return authenticationRequired(e);
        }
        String mode = stringValue(body, "mode");
        if (!"bind_existing_page".equals(mode)
            && !"create_page_await_user_login".equals(mode)
            && !"bind_existing_context".equals(mode)) {
            return fail(400, "validation_failed", "invalid bind mode");
        }
        String recordingMode = defaultString(body, "recordingMode", "vnc");
        if (!"tab_projection".equals(recordingMode) && !"embedded_iframe".equals(recordingMode) && !"vnc".equals(recordingMode)) {
            return fail(400, "validation_failed", "invalid recordingMode");
        }
        RecorderSession session = sessionRegistry.createSession(
            owner,
            stringValue(body, "contextId"),
            stringValue(body, "targetId"),
            "create_page_await_user_login".equals(mode),
            recordingMode
        );

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("sessionId", session.sessionId());
        data.put("contextId", session.contextId());
        data.put("targetId", session.targetId());
        data.put("awaitingLogin", session.awaitingLogin());
        data.put("stateVersion", session.stateVersion());
        data.put("recordingMode", session.recordingMode());
        if (session.isVnc()) {
            try {
                RecorderVncEndpoint endpoint = vncProvider.start(session);
                session.vncProvider(endpoint.provider());
                session.vncUrl(endpoint.vncUrl());
                session.vncContainerName(endpoint.containerName());
                session.vncPort(endpoint.vncPort());
                session.gatewayHost(endpoint.gatewayHost());
                session.gatewayPort(endpoint.gatewayPort());
                data.put("vncUrl", endpoint.vncUrl());
            } catch (RecorderBrowserException e) {
                session.state(RecorderSessionState.FAILED);
                return fail(e.getHttpStatus(), e.getCode(), e.getMessage());
            }
        }
        return ok(data);
    }

    public RecorderResponse<Map<String, Object>> confirmAuth(Map<String, Object> body) {
        RecorderResponse<Map<String, Object>> checked = requireSession(body);
        if (checked != null) {
            return checked;
        }
        RecorderSession session = session(body);
        if (!sessionRegistry.advance(session, RecorderSessionAction.CONFIRM_AUTH, RecorderSessionState.PAGE_READY)) {
            return fail(400, "invalid_state", "cannot confirm auth from " + session.state().wireValue());
        }
        session.awaitingLogin(false);
        return ok(sessionState(session));
    }

    public RecorderResponse<Map<String, Object>> navigate(Map<String, Object> body) {
        RecorderResponse<Map<String, Object>> checked = requireSession(body);
        if (checked != null) {
            return checked;
        }
        String url = stringValue(body, "url");
        if (url == null || url.isBlank()) {
            return fail(400, "validation_failed", "url required");
        }
        RecorderSession session = session(body);
        if (!sessionRegistry.canAdvance(session, RecorderSessionAction.NAVIGATE)) {
            return fail(400, "invalid_state", "cannot navigate from " + session.state().wireValue());
        }
        Map<String, Object> data = sessionState(session);
        try {
            data.putAll(browserPort.navigate(session, url));
            sessionRegistry.advance(session, RecorderSessionAction.NAVIGATE, RecorderSessionState.PAGE_READY);
            data.put("state", session.state().wireValue());
            data.put("stateVersion", session.stateVersion());
            return ok(data);
        } catch (RecorderBrowserException e) {
            return fail(e.getHttpStatus(), e.getCode(), e.getMessage());
        }
    }

    public RecorderResponse<Map<String, Object>> captureStart(Map<String, Object> body) {
        RecorderResponse<Map<String, Object>> checked = requireSession(body);
        if (checked != null) {
            return checked;
        }
        String sampleName = stringValue(body, "sampleName");
        if (!"A".equals(sampleName) && !"B".equals(sampleName)) {
            return fail(400, "validation_failed", "sampleName required");
        }
        RecorderSession session = session(body);
        if (!sessionRegistry.canAdvance(session, RecorderSessionAction.CAPTURE_START)) {
            return fail(400, "invalid_state", "cannot start capture from " + session.state().wireValue());
        }
        Map<String, Object> data = sessionState(session);
        try {
            data.putAll(browserPort.captureStart(session, sampleName));
            return ok(data);
        } catch (RecorderBrowserException e) {
            return fail(e.getHttpStatus(), e.getCode(), e.getMessage());
        }
    }

    public RecorderResponse<Map<String, Object>> captureRead(Map<String, Object> body) {
        RecorderResponse<Map<String, Object>> checked = requireSession(body);
        if (checked != null) {
            return checked;
        }
        String sampleName = stringValue(body, "sampleName");
        if (!"A".equals(sampleName) && !"B".equals(sampleName)) {
            return fail(400, "validation_failed", "sampleName required");
        }
        RecorderSession session = session(body);
        if (!sessionRegistry.canAdvance(session, RecorderSessionAction.CAPTURE_READ)) {
            return fail(400, "invalid_state", "cannot read capture from " + session.state().wireValue());
        }
        Map<String, Object> data = sessionState(session);
        try {
            data.putAll(browserPort.captureRead(session, sampleName, defaultString(body, "seed", sampleName.equals("A") ? "alpha" : "beta")));
            sessionRegistry.advance(session, RecorderSessionAction.CAPTURE_READ, "B".equals(sampleName) ? RecorderSessionState.CAPTURE_B : RecorderSessionState.CAPTURE_A);
            data.put("state", session.state().wireValue());
            data.put("stateVersion", session.stateVersion());
            return ok(data);
        } catch (RecorderBrowserException e) {
            return fail(e.getHttpStatus(), e.getCode(), e.getMessage());
        }
    }

    public RecorderResponse<Map<String, Object>> screenshot(Map<String, Object> body) {
        RecorderResponse<Map<String, Object>> checked = requireSession(body);
        if (checked != null) {
            return checked;
        }
        try {
            return ok(browserPort.screenshot(session(body), numberValue(body, "quality", 60L) > Integer.MAX_VALUE ? 60 : (int) numberValue(body, "quality", 60L)));
        } catch (RecorderBrowserException e) {
            return fail(e.getHttpStatus(), e.getCode(), e.getMessage());
        }
    }

    public RecorderResponse<Map<String, Object>> input(Map<String, Object> body) {
        RecorderResponse<Map<String, Object>> checked = requireSession(body);
        if (checked != null) {
            return checked;
        }
        Map<String, Object> cdpParams = body.get("cdpParams") instanceof Map<?, ?> params ? map(params) : Map.of();
        try {
            return ok(browserPort.input(session(body), stringValue(body, "cdpMethod"), cdpParams));
        } catch (RecorderBrowserException e) {
            return fail(e.getHttpStatus(), e.getCode(), e.getMessage());
        }
    }

    public RecorderResponse<Map<String, Object>> rank(Map<String, Object> body) {
        RecorderResponse<Map<String, Object>> checked = requireSession(body);
        if (checked != null) {
            return checked;
        }
        RecorderSession session = session(body);
        if (!sessionRegistry.advance(session, RecorderSessionAction.RANK, RecorderSessionState.RANKED)) {
            return fail(400, "invalid_state", "cannot rank from " + session.state().wireValue());
        }
        session.candidates(rankService.rank(session));
        if (session.candidates().isEmpty()) {
            return fail(400, "insufficient_samples", "no captured entries to rank");
        }

        Map<String, Object> data = sessionState(session);
        data.put("candidates", session.candidates());
        data.put("scorePrompt", "Stub score prompt for recorder candidate ranking.");
        return ok(data);
    }

    public RecorderResponse<Map<String, Object>> analyze(Map<String, Object> body) {
        RecorderResponse<Map<String, Object>> checked = requireSession(body);
        if (checked != null) {
            return checked;
        }
        String url = stringValue(body, "url");
        if (url == null || url.isBlank()) {
            return fail(400, "validation_failed", "url required");
        }
        Map<String, Object> report = new LinkedHashMap<>();
        report.put("requestedUrl", url);
        report.put("finalUrl", url);
        report.put("adapterCandidates", List.of());
        report.put("signals", Map.of(
            "cookieNames", List.of(),
            "networkEntries", List.of(),
            "initialState", Map.of(
                "__INITIAL_STATE__", false,
                "__NUXT__", false,
                "__NEXT_DATA__", false,
                "__APOLLO_STATE__", false
            ),
            "title", "Recorder stub page"
        ));
        return accepted(session(body), "analyze", report);
    }

    public RecorderResponse<Map<String, Object>> init(Map<String, Object> body) {
        RecorderResponse<Map<String, Object>> checked = requireSession(body);
        if (checked != null) {
            return checked;
        }
        if (isBlank(body, "name")) {
            return fail(400, "validation_failed", "name required");
        }
        if (isBlank(body, "selectedCandidateId")) {
            return fail(400, "validation_failed", "selectedCandidateId required (init is select-only)");
        }
        RecorderSession session = session(body);
        synchronized (session) {
            if (!sessionRegistry.canAdvance(session, RecorderSessionAction.INIT)) {
                return fail(400, "invalid_state", "cannot init from " + session.state().wireValue());
            }
            Map<String, Object> selectedCandidate = selectedCandidate(session, stringValue(body, "selectedCandidateId"));
            if (selectedCandidate == null) {
                return fail(400, "validation_failed", "selectedCandidateId does not match a ranked candidate");
            }
            if ("write".equals(stringValue(body, "writePolicy"))) {
                sessionRegistry.advance(session, RecorderSessionAction.INIT, RecorderSessionState.DRAFT_CREATED);
            }
            Map<String, Object> report = new LinkedHashMap<>();
            report.put("adapterPath", "clis/example/search.js");
            report.put("reportPath", "reports/example/search.md");
            report.put("warnings", List.of("BE-0 contract stub: no filesystem write was performed."));
            report.put("responsibleUseAcknowledgedAt", numberValue(body, "responsibleUseAcknowledgedAt", 0L));
            report.put("releaseChannel", "stub");
            report.put("localExperimentProfile", "be-0");
            report.put("configSnapshotVersion", 1);
            return ok(Map.of(
                "report", report,
                "dryRun", Map.of("exists", false, "changedLines", 0),
                "generatedSource", generatedSource(selectedCandidate),
                "llmSynthesisOffered", false
            ));
        }
    }

    public RecorderResponse<Map<String, Object>> verify(Map<String, Object> body) {
        RecorderResponse<Map<String, Object>> checked = requireSession(body);
        if (checked != null) {
            return checked;
        }
        if (isBlank(body, "name")) {
            return fail(400, "validation_failed", "name required");
        }
        RecorderSession session = session(body);
        synchronized (session) {
            if (!sessionRegistry.canAdvance(session, RecorderSessionAction.VERIFY)) {
                return fail(400, "invalid_state", "cannot verify from " + session.state().wireValue());
            }
            try {
                String requestId = verifyService.start(
                    session.sessionId(),
                    session.owner(),
                    "verify",
                    stringValue(body, "name"),
                    stringValue(body, "adapterPath"),
                    body.get("executionSeedArgs") instanceof Map<?, ?> raw ? map(raw) : Map.of(),
                    summary -> summary,
                    () -> {
                        if (!sessionRegistry.advance(session, RecorderSessionAction.VERIFY, RecorderSessionState.VERIFYING)) {
                            throw new RecorderVerifyException("invalid_state", "cannot verify from " + session.state().wireValue());
                        }
                    },
                    (status, result) -> {
                        synchronized (session) {
                            if ("succeeded".equals(status)) {
                                sessionRegistry.advance(session, RecorderSessionAction.COMPLETE_VERIFY, RecorderSessionState.DONE);
                            } else {
                                sessionRegistry.advance(session, RecorderSessionAction.FAIL_VERIFY, RecorderSessionState.FAILED);
                            }
                        }
                    }
                );
                return accepted(requestId, session.sessionId(), "verify", Map.of("state", "verifying"));
            } catch (RecorderVerifyException e) {
                return fail(verifyHttpStatus(e.getCode()), e.getCode(), e.getMessage(), e.getRequestId());
            }
        }
    }

    public RecorderResponse<Map<String, Object>> pipeline(Map<String, Object> body) {
        RecorderResponse<Map<String, Object>> checked = requireSession(body);
        if (checked != null) {
            return checked;
        }
        RecorderSession session = session(body);
        synchronized (session) {
            if (!sessionRegistry.canAdvance(session, RecorderSessionAction.PIPELINE)) {
                return fail(400, "invalid_state", "cannot run pipeline from " + session.state().wireValue());
            }
            try {
                return accepted(session, "pipeline", pipelineService.pipeline(session, stringList(body.get("candidateIds"))));
            } catch (RecorderSaveException e) {
                return bycliStorageUnavailable();
            }
        }
    }

    public RecorderResponse<Map<String, Object>> pipelineScore(Map<String, Object> body) {
        RecorderResponse<Map<String, Object>> checked = requireSession(body);
        if (checked != null) {
            return checked;
        }
        RecorderSession session = session(body);
        synchronized (session) {
            if (!sessionRegistry.canAdvance(session, RecorderSessionAction.PIPELINE)) {
                return fail(400, "invalid_state", "cannot run pipeline stage from " + session.state().wireValue());
            }
            return accepted(session, "pipeline", pipelineService.score(session, stringList(body.get("candidateIds"))));
        }
    }

    public RecorderResponse<Map<String, Object>> pipelineGenerate(Map<String, Object> body) {
        RecorderResponse<Map<String, Object>> checked = requireSession(body);
        if (checked != null) {
            return checked;
        }
        RecorderSession session = session(body);
        synchronized (session) {
            if (!sessionRegistry.canAdvance(session, RecorderSessionAction.PIPELINE)) {
                return fail(400, "invalid_state", "cannot run pipeline stage from " + session.state().wireValue());
            }
            try {
                return accepted(session, "pipeline", pipelineService.generate(session, stringList(body.get("candidateIds"))));
            } catch (RecorderSaveException e) {
                return bycliStorageUnavailable();
            }
        }
    }

    public RecorderResponse<Map<String, Object>> draftVerify(Map<String, Object> body) {
        RecorderResponse<Map<String, Object>> checked = requireSession(body);
        if (checked != null) {
            return checked;
        }
        String draftId = stringValue(body, "draftId");
        if (draftId == null || draftId.isBlank()) {
            return fail(400, "validation_failed", "draftId required");
        }
        RecorderSession session = session(body);
        synchronized (session) {
            if (!sessionRegistry.canAdvance(session, RecorderSessionAction.PIPELINE)) {
                return fail(400, "invalid_state", "cannot verify draft from " + session.state().wireValue());
            }
            try {
                return pipelineService.verifyDraft(session, draftId, stringValue(body, "source"))
                    .map(requestId -> accepted(requestId, session.sessionId(), "verify", Map.of()))
                    .orElseGet(() -> fail(400, "validation_failed", "unknown draftId " + draftId));
            } catch (RecorderVerifyException e) {
                return fail(verifyHttpStatus(e.getCode()), e.getCode(), e.getMessage(), e.getRequestId());
            } catch (RecorderSaveException e) {
                return bycliStorageUnavailable();
            }
        }
    }

    public RecorderResponse<Map<String, Object>> pipelinePreview(Map<String, Object> body) {
        RecorderResponse<Map<String, Object>> checked = requireSession(body);
        if (checked != null) {
            return checked;
        }
        RecorderSession session = session(body);
        synchronized (session) {
            if (!sessionRegistry.canAdvance(session, RecorderSessionAction.PIPELINE)) {
                return fail(400, "invalid_state", "cannot preview pipeline from " + session.state().wireValue());
            }
            return ok(pipelineService.preview(session, stringList(body.get("candidateIds"))));
        }
    }

    public RecorderResponse<Map<String, Object>> save(Map<String, Object> body) {
        RecorderResponse<Map<String, Object>> checked = requireSession(body);
        if (checked != null) {
            return checked;
        }
        RecorderSession session = session(body);
        if (!sessionRegistry.canAdvance(session, RecorderSessionAction.SAVE_ADAPTER)) {
            return fail(400, "invalid_state", "cannot save from " + session.state().wireValue());
        }
        RecorderOwner owner = session.owner();
        synchronized (session) {
            if (!sessionRegistry.canAdvance(session, RecorderSessionAction.SAVE_ADAPTER)) {
                return fail(400, "invalid_state", "cannot save from " + session.state().wireValue());
            }
            try {
                if (body.containsKey("drafts")) {
                    if (body.containsKey("draftId")) {
                        throw new RecorderSaveException("validation_failed", "choose single or batch save");
                    }
                    return saveBatch(body.get("drafts"), owner, session);
                }
                return saveSingle(body, owner, session);
            } catch (RecorderSaveException e) {
                return fail(saveHttpStatus(e.getCode()), e.getCode(), safeSaveMessage(e), e.getDetails());
            } catch (RuntimeException e) {
                log.error("Recorder adapter save failed for session {}", session.sessionId(), e);
                return fail(500, "resource_save_failed", "resource save failed");
            }
        }
    }

    private RecorderResponse<Map<String, Object>> saveSingle(
        Map<String, Object> body,
        RecorderOwner owner,
        RecorderSession session
    ) {
        String draftId = stringValue(body, "draftId");
        if (draftId == null || draftId.isBlank()) {
            throw new RecorderSaveException("validation_failed", "draftId required");
        }
        Map<String, Object> draft = snapshotDraft(requireDraft(session, draftId));
        RecorderResourceSaveService.SavedAdapter saved = resourceSaveService.save(
            owner, session, draft, requestedSource(body), overwrite(body)
        );
        Map<String, Object> data = savedAdapter(saved);
        data.put("state", session.state().wireValue());
        data.put("saved", List.of(savedAdapter(saved)));
        return ok(data);
    }

    private RecorderResponse<Map<String, Object>> saveBatch(
        Object rawDrafts,
        RecorderOwner owner,
        RecorderSession session
    ) {
        if (!(rawDrafts instanceof List<?> items) || items.isEmpty()) {
            throw new RecorderSaveException("validation_failed", "drafts[] required");
        }
        List<Map<String, Object>> draftCollection = session.drafts();
        List<SelectedDraft> selectedDrafts = new ArrayList<>();
        List<RecorderResourceSaveService.DraftSaveRequest> requests = new ArrayList<>();
        Set<String> selected = new HashSet<>();
        for (Object item : items) {
            if (!(item instanceof Map<?, ?> raw)) {
                throw new RecorderSaveException("validation_failed", "each draft selection must be an object");
            }
            Map<String, Object> selection = map(raw);
            String draftId = stringValue(selection, "draftId");
            if (draftId == null || draftId.isBlank()) {
                throw new RecorderSaveException("validation_failed", "draftId required");
            }
            if (!selected.add(draftId)) {
                throw new RecorderSaveException("validation_failed", "duplicate draftId " + draftId);
            }
            Map<String, Object> liveDraft = requireDraft(session, draftId);
            Map<String, Object> snapshot = snapshotDraft(liveDraft);
            selectedDrafts.add(new SelectedDraft(liveDraft, snapshot));
            requests.add(new RecorderResourceSaveService.DraftSaveRequest(
                snapshot,
                requestedSource(selection),
                overwrite(selection)
            ));
        }
        RecorderResourceSaveService.BatchSaveResult result = resourceSaveService.saveMany(owner, session, requests);
        if (result.allSucceeded() && draftsStillMatch(session, draftCollection, selectedDrafts)) {
            if (!sessionRegistry.advance(session, RecorderSessionAction.COMPLETE_SAVE, RecorderSessionState.DONE)) {
                throw new RecorderSaveException("invalid_state", "cannot complete save from " + session.state().wireValue());
            }
        }
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("state", session.state().wireValue());
        data.put("saved", result.saved().stream().map(this::savedAdapter).toList());
        data.put("failed", result.failed().stream().map(this::failedAdapter).toList());
        data.put("allSucceeded", result.allSucceeded());
        return ok(data);
    }

    private boolean draftsStillMatch(
        RecorderSession session,
        List<Map<String, Object>> expectedCollection,
        List<SelectedDraft> selectedDrafts
    ) {
        List<Map<String, Object>> currentCollection = session.drafts();
        if (currentCollection != expectedCollection) {
            return false;
        }
        for (SelectedDraft selected : selectedDrafts) {
            if (currentCollection.stream().noneMatch(draft -> draft == selected.live())) {
                return false;
            }
            synchronized (selected.live()) {
                if (!java.util.Objects.equals(selected.live().get("source"), selected.snapshot().get("source"))
                    || !java.util.Objects.equals(
                        selected.live().get("verifiedSourceHash"), selected.snapshot().get("verifiedSourceHash")
                    )) {
                    return false;
                }
            }
        }
        return true;
    }

    private Map<String, Object> requireDraft(RecorderSession session, String draftId) {
        return session.drafts().stream()
            .filter(draft -> {
                synchronized (draft) {
                    return draftId.equals(draft.get("id"));
                }
            })
            .findFirst()
            .orElseThrow(() -> new RecorderSaveException("validation_failed", "unknown draftId " + draftId));
    }

    private Map<String, Object> snapshotDraft(Map<String, Object> draft) {
        synchronized (draft) {
            return java.util.Collections.unmodifiableMap(new LinkedHashMap<>(draft));
        }
    }

    private String requestedSource(Map<String, Object> selection) {
        if (!selection.containsKey("source")) {
            return null;
        }
        Object value = selection.get("source");
        if (!(value instanceof String source)) {
            throw new RecorderSaveException("validation_failed", "source must be a string");
        }
        return source;
    }

    private boolean overwrite(Map<String, Object> selection) {
        if (!selection.containsKey("overwrite")) {
            return false;
        }
        Object value = selection.get("overwrite");
        if (value instanceof Boolean overwrite) {
            return overwrite;
        }
        throw new RecorderSaveException("validation_failed", "overwrite must be a boolean");
    }

    private Map<String, Object> savedAdapter(RecorderResourceSaveService.SavedAdapter saved) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("draftId", saved.draftId());
        item.put("site", saved.site());
        item.put("name", saved.name());
        item.put("adapterPath", saved.adapterPath());
        item.put("reportPath", saved.reportPath());
        return item;
    }

    private Map<String, Object> failedAdapter(RecorderResourceSaveService.FailedAdapter failed) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("draftId", failed.draftId());
        item.put("code", failed.code());
        item.put("reason", publicSaveMessage(failed.code()));
        if (failed.adapterPath() != null) {
            item.put("adapterPath", failed.adapterPath());
        }
        return item;
    }

    public RecorderResponse<Map<String, Object>> cancel(Map<String, Object> body) {
        RecorderOwner owner;
        try {
            owner = currentUserProvider.requireCurrent();
        } catch (RecorderSaveException e) {
            return authenticationRequired(e);
        }
        String sessionId = stringValue(body, "sessionId");
        if (sessionId != null) {
            RecorderSession session = sessionRegistry.getOwned(sessionId, owner).orElse(null);
            if (session == null) {
                return fail(404, "session_not_found", "session not found");
            } else {
                synchronized (session) {
                    sessionRegistry.cancel(sessionId);
                    vncProvider.stop(sessionId);
                    try {
                        draftStore.deleteSession(session.owner(), sessionId);
                    } catch (RecorderSaveException e) {
                        log.warn("Recorder draft cleanup failed after session cancellation");
                    }
                }
            }
        }
        return ok(Map.of("cancelled", true));
    }

    public RecorderResponse<Map<String, Object>> requestStatus(String requestId) {
        RecorderOwner owner;
        try {
            owner = currentUserProvider.requireCurrent();
        } catch (RecorderSaveException e) {
            return authenticationRequired(e);
        }
        return requestRegistry.getOwned(requestId, owner)
            .map(this::ok)
            .orElseGet(() -> fail(404, "request_not_found", "request unknown or expired"));
    }

    private RecorderResponse<Map<String, Object>> accepted(RecorderSession session, String type, Map<String, Object> result) {
        String requestId = requestRegistry.nextRequestId();
        requestRegistry.createSucceeded(requestId, type, result, session.owner());
        return accepted(requestId, session.sessionId(), type, Map.of());
    }

    private RecorderResponse<Map<String, Object>> accepted(
        String requestId,
        String sessionId,
        String type,
        Map<String, Object> extra
    ) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("accepted", true);
        data.put("sessionId", sessionId);
        data.put("type", type);
        data.putAll(extra);
        return new RecorderResponse<>(202, RecorderEnvelope.ok(requestId, data));
    }

    private RecorderResponse<Map<String, Object>> ok(Map<String, Object> data) {
        return new RecorderResponse<>(200, RecorderEnvelope.ok(requestRegistry.nextRequestId(), data));
    }

    private RecorderResponse<Map<String, Object>> bycliStorageUnavailable() {
        return fail(503, "bycli_storage_unavailable", "bycli storage unavailable");
    }

    private <T> RecorderResponse<T> fail(int status, String code, String message) {
        return failure(status, code, message, null, null);
    }

    private <T> RecorderResponse<T> fail(int status, String code, String message, String requestId) {
        return failure(status, code, message, requestId, null);
    }

    private <T> RecorderResponse<T> fail(int status, String code, String message, Map<String, Object> details) {
        return failure(status, code, message, null, details);
    }

    private <T> RecorderResponse<T> failure(
        int status,
        String code,
        String message,
        String requestId,
        Map<String, Object> details
    ) {
        return new RecorderResponse<>(
            status,
            new RecorderEnvelope<>(
                false,
                "recorder.v1",
                requestId == null ? requestRegistry.nextRequestId() : requestId,
                null,
                new RecorderError(code, message, null, details)
            )
        );
    }

    private int verifyHttpStatus(String code) {
        if ("validation_failed".equals(code) || "invalid_state".equals(code)) {
            return 400;
        }
        if ("verify_timeout".equals(code) || "daemon_timeout".equals(code)) {
            return 504;
        }
        if ("daemon_unavailable".equals(code) || "queue_full".equals(code)) {
            return 503;
        }
        return 502;
    }

    private int saveHttpStatus(String code) {
        return switch (code) {
            case "authentication_required" -> 401;
            case "session_not_found" -> 404;
            case "validation_failed", "invalid_state" -> 400;
            case "adapter_exists", "verification_required", "source_changed_after_verify" -> 409;
            case "daemon_protocol_error" -> 502;
            case "save_adapter_disabled", "bycli_storage_unavailable", "daemon_unavailable" -> 503;
            case "daemon_timeout" -> 504;
            default -> 500;
        };
    }

    private String safeSaveMessage(RecorderSaveException exception) {
        return publicSaveMessage(exception.getCode());
    }

    private String publicSaveMessage(String code) {
        return switch (code) {
            case "authentication_required" -> "authentication required";
            case "session_not_found" -> "session not found";
            case "validation_failed" -> "invalid save request";
            case "invalid_state" -> "save is not allowed in the current state";
            case "verification_required" -> "draft verification is required";
            case "source_changed_after_verify" -> "source changed after verification";
            case "adapter_exists" -> "CLI adapter already exists";
            case "save_adapter_disabled" -> "production adapter publishing is disabled";
            case "bycli_storage_unavailable" -> "bycli storage unavailable";
            case "daemon_unavailable" -> "user byCLI daemon is unavailable";
            case "daemon_timeout" -> "user byCLI daemon timed out";
            case "daemon_protocol_error" -> "invalid response from user byCLI daemon";
            default -> "resource save failed";
        };
    }

    private RecorderResponse<Map<String, Object>> requireSession(Map<String, Object> body) {
        RecorderOwner owner;
        try {
            owner = currentUserProvider.requireCurrent();
        } catch (RecorderSaveException e) {
            return authenticationRequired(e);
        }
        String sessionId = stringValue(body, "sessionId");
        if (sessionId == null || sessionId.isBlank()) {
            return fail(400, "validation_failed", "sessionId required");
        }
        if (sessionRegistry.getOwned(sessionId, owner).isEmpty()) {
            return fail(404, "session_not_found", "session not found");
        }
        RecorderSession session = sessionRegistry.getOwned(sessionId, owner).orElseThrow();
        if (session.state().isTerminal()) {
            return fail(400, "invalid_state", "session is " + session.state().wireValue());
        }
        return null;
    }

    private RecorderSession session(Map<String, Object> body) {
        RecorderOwner owner = currentUserProvider.requireCurrent();
        return sessionRegistry.getOwned(stringValue(body, "sessionId"), owner).orElseThrow();
    }

    private <T> RecorderResponse<T> authenticationRequired(RecorderSaveException exception) {
        return fail(401, "authentication_required", exception.getMessage());
    }

    private String stringValue(Map<String, Object> body, String key) {
        Object value = body.get(key);
        return value instanceof String text ? text : null;
    }

    private String defaultString(Map<String, Object> body, String key, String defaultValue) {
        String value = stringValue(body, key);
        return value == null || value.isBlank() ? defaultValue : value;
    }

    private boolean isBlank(Map<String, Object> body, String key) {
        String value = stringValue(body, key);
        return value == null || value.isBlank();
    }

    private long numberValue(Map<String, Object> body, String key, long defaultValue) {
        Object value = body.get(key);
        return value instanceof Number number ? number.longValue() : defaultValue;
    }

    private List<String> stringList(Object value) {
        if (!(value instanceof List<?> items)) {
            return List.of();
        }
        return items.stream().filter(String.class::isInstance).map(String.class::cast).toList();
    }

    private Map<String, Object> map(Map<?, ?> raw) {
        Map<String, Object> mapped = new LinkedHashMap<>();
        raw.forEach((key, value) -> {
            if (key instanceof String text) {
                mapped.put(text, value);
            }
        });
        return mapped;
    }

    private Map<String, Object> selectedCandidate(RecorderSession session, String selectedCandidateId) {
        return session.candidates().stream()
            .filter(candidate -> selectedCandidateId.equals(stringValue(candidate, "id")))
            .findFirst()
            .orElse(null);
    }

    private String generatedSource(Map<String, Object> candidate) {
        Map<String, Object> endpoint = candidate.get("endpoint") instanceof Map<?, ?> raw ? map(raw) : Map.of();
        String method = defaultString(endpoint, "method", "GET");
        String pathname = defaultString(endpoint, "pathname", "/");
        List<String> params = candidate.get("args") instanceof List<?> args
            ? args.stream()
                .filter(Map.class::isInstance)
                .map(Map.class::cast)
                .map(this::map)
                .map(arg -> defaultString(arg, "argName", defaultString(arg, "paramName", "")))
                .filter(name -> !name.isBlank())
                .toList()
            : List.of();
        List<String> columns = candidate.get("columns") instanceof List<?> items
            ? items.stream()
                .filter(Map.class::isInstance)
                .map(Map.class::cast)
                .map(this::map)
                .map(column -> defaultString(column, "name", "value"))
                .toList()
            : List.of();

        return """
            // Generated from the selected recorder endpoint. Review before writing.
            export default {
              request: { method: '%s', path: '%s', params: [%s] },
              columns: [%s],
            };
            """.formatted(
                jsString(method),
                jsString(pathname),
                params.stream().map(name -> "'" + jsString(name) + "'").collect(java.util.stream.Collectors.joining(", ")),
                columns.stream().map(name -> "'" + jsString(name) + "'").collect(java.util.stream.Collectors.joining(", "))
            );
    }

    private String jsString(String value) {
        return value.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n").replace("\r", "\\r");
    }

    private Map<String, Object> sessionState(RecorderSession session) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("sessionId", session.sessionId());
        data.put("state", session.state().wireValue());
        data.put("stateVersion", session.stateVersion());
        return data;
    }

    private record SelectedDraft(Map<String, Object> live, Map<String, Object> snapshot) {
    }

}
