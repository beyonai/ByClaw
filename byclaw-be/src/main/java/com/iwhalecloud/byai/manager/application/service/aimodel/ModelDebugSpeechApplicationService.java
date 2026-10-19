package com.iwhalecloud.byai.manager.application.service.aimodel;

import com.iwhalecloud.byai.common.i18n.I18nUtil;

import com.iwhalecloud.byai.state.application.service.asr.HarnessMediaClient;
import com.iwhalecloud.byai.state.application.service.asr.VoiceAudioService;
import java.net.URI;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/** Speech debugging shares the runtime provider adapters instead of implementing vendor HTTP protocols here. */
@Service
public class ModelDebugSpeechApplicationService {
    private final VoiceAudioService audio;
    private final HarnessMediaClient media;
    private final ModelManagementApplicationService management;

    public ModelDebugSpeechApplicationService(VoiceAudioService audio, HarnessMediaClient media, ModelManagementApplicationService management) {
        this.audio = audio;
        this.media = media;
        this.management = management;
    }

    public Map<String, Object> debugAsr(DebugRequest request) {
        if (request == null) throw invalid();
        Map<String, Object> model = connectionModel(request.model(), request.id(), "ASR");
        return media.transcribe(audio.load(request.fileId(), request.sessionId()), model);
    }

    public Map<String, Object> debugTts(TtsDebugRequest request) {
        if (request == null) throw invalid();
        String text = request.text() == null || request.text().isBlank() ? I18nUtil.get("aimodel.debug.speech.default.text") : request.text();
        if (text.length() > 1000) throw invalid();
        return media.debugTts(text, connectionModel(request.model(), request.id(), "TTS"));
    }

    private Map<String, Object> connectionModel(Map<String, Object> input, String id, String type) {
        Map<String, Object> model = input == null ? savedModel(id, type) : new LinkedHashMap<>(input);
        for (String key : new String[] { "provider", "protocol", "model", "endpoint", "apiKey" }) {
            if (!(model.get(key) instanceof String value) || value.isBlank()) throw invalid();
        }
        try {
            URI endpoint = URI.create((String) model.get("endpoint"));
            if (!("http".equalsIgnoreCase(endpoint.getScheme()) || "https".equalsIgnoreCase(endpoint.getScheme()))
                || endpoint.getHost() == null || endpoint.getUserInfo() != null || endpoint.getFragment() != null) {
                throw invalid();
            }
        } catch (IllegalArgumentException e) {
            throw invalid();
        }
        model.put("provider", model.get("provider").toString().trim().toUpperCase(java.util.Locale.ROOT));
        model.put("protocol", model.get("protocol").toString().trim().toUpperCase(java.util.Locale.ROOT));
        model.putIfAbsent("headers", Map.of());
        model.putIfAbsent("options", Map.of());
        model.put("timeoutMs", 120000);
        return model;
    }

    private Map<String, Object> savedModel(String id, String type) {
        if (id == null || id.isBlank()) throw invalid();
        var saved = management.getModelDetail(id);
        if (!type.equalsIgnoreCase(saved.getModelType())) throw invalid();
        Map<String, Object> model = new LinkedHashMap<>();
        model.put("provider", saved.getProviderName());
        model.put("protocol", saved.getModelProtocol());
        model.put("model", saved.getModelCode());
        model.put("endpoint", saved.getApiEndpoint());
        model.put("apiKey", saved.getApiToken());
        Map<String, String> headers = new LinkedHashMap<>();
        if (saved.getHeaders() != null) {
            for (Map<String, String> header : saved.getHeaders()) {
                String name = header.get("key");
                String value = header.get("value");
                if (name != null && value != null) headers.put(name, value);
            }
        }
        model.put("headers", headers);
        if (saved.getExtendParam() != null && !saved.getExtendParam().isBlank()) {
            try {
                model.put("options", com.alibaba.fastjson.JSON.parseObject(saved.getExtendParam()));
            } catch (RuntimeException e) {
                throw invalid();
            }
        }
        return model;
    }

    private ResponseStatusException invalid() {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, I18nUtil.get("aimodel.debug.speech.input.invalid"));
    }

    public record TtsDebugRequest(String id, String text, Map<String, Object> model) {
    }

    public record DebugRequest(String id, Long fileId, Long sessionId, Map<String, Object> model) {
    }
}
