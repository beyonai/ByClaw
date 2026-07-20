package com.iwhalecloud.byai.state.application.service.recorder;

import com.iwhalecloud.byai.state.domain.recorder.model.RecorderSession;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class InMemoryRecorderBrowserPort implements RecorderBrowserPort {

    @Override
    public Map<String, Object> health() {
        return Map.of(
            "localService", "ok",
            "daemon", "down",
            "extension", "disconnected",
            "highLevel", "down",
            "llmSynthesis", false
        );
    }

    @Override
    public Map<String, Object> navigate(RecorderSession session, String url) {
        session.targetId("page_" + session.sessionId());
        session.currentUrl(url);
        return Map.of(
            "page", session.targetId(),
            "url", url,
            "title", "Recorder test page"
        );
    }

    @Override
    public Map<String, Object> captureStart(RecorderSession session, String sampleName) {
        return Map.of(
            "sampleName", sampleName,
            "started", true
        );
    }

    @Override
    public Map<String, Object> captureRead(RecorderSession session, String sampleName, String seed) {
        String url = session.currentUrl() != null ? session.currentUrl() : "https://example.com/search?q=" + seed;
        Map<String, Object> entry = new LinkedHashMap<>();
        entry.put("requestId", sampleName + "-1");
        entry.put("method", "GET");
        entry.put("url", url);
        entry.put("status", 200);
        entry.put("responseStatus", 200);
        entry.put("responseContentType", "application/json");
        entry.put("startedAt", Instant.now().toEpochMilli());
        entry.put("durationMs", 128);
        session.samples().put(sampleName, List.of(entry));
        return Map.of(
            "sampleName", sampleName,
            "entries", session.samples().get(sampleName),
            "actions", List.of(),
            "actionsDropped", 0
        );
    }

    @Override
    public Map<String, Object> screenshot(RecorderSession session, Integer quality) {
        return Map.of("format", "jpeg", "data", "");
    }

    @Override
    public Map<String, Object> input(RecorderSession session, String cdpMethod, Map<String, Object> cdpParams) {
        return Map.of("dispatched", true);
    }
}
