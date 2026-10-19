package com.iwhalecloud.byai.state.application.service.asr;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.application.service.files.FilesApplicationService;
import com.iwhalecloud.byai.manager.domain.customer.service.FilesService;
import com.iwhalecloud.byai.manager.entity.file.Files;
import com.iwhalecloud.byai.state.application.service.chat.ChatFileArtifactApplicationService;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.util.UriComponentsBuilder;

/** Resolve uploaded voice bytes only from a persisted file owned by the logged-in user. */
@Service
public class VoiceAudioService {
    public static final int MAX_AUDIO_BYTES = 12 * 1024 * 1024;
    private final FilesService files;
    private final FilesApplicationService storage;
    private final ChatFileArtifactApplicationService artifacts;

    public VoiceAudioService(FilesService files, FilesApplicationService storage,
        ChatFileArtifactApplicationService artifacts) {
        this.files = files;
        this.storage = storage;
        this.artifacts = artifacts;
    }

    /** Read summary MP3 bytes through the same session and path authorization as artifact playback. */
    public VoiceAudio loadArtifact(Long sessionId, String path) {
        if (CurrentUserHolder.getLoginInfo() == null || CurrentUserHolder.getCurrentUserId() == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Authentication required");
        }
        if (sessionId == null || sessionId <= 0 || path == null
            || !(path.startsWith("/by/.sessions/") || path.startsWith("/.sessions/"))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "A session artifact path is required");
        }
        var download = artifacts.download(sessionId, path);
        String name = download.getFileName();
        if (name == null || name.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 512
            || !name.toLowerCase(java.util.Locale.ROOT).endsWith(".mp3")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Voice file must be MP3");
        }
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        OutputStream bounded = new OutputStream() {
            @Override
            public void write(int value) {
                checkLimit(1);
                bytes.write(value);
            }

            @Override
            public void write(byte[] value, int offset, int length) {
                checkLimit(length);
                bytes.write(value, offset, length);
            }

            private void checkLimit(int incoming) {
                if (incoming > MAX_AUDIO_BYTES - bytes.size()) {
                    throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "Voice file exceeds 12 MB");
                }
            }
        };
        try {
            download.getBody().writeTo(bounded);
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Voice file could not be read");
        }
        byte[] audio = bytes.toByteArray();
        if (!isMp3(audio)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid MP3 audio");
        return new VoiceAudio(null, sessionId, name, audio);
    }

    public static void validateDuration(Number duration) {
        if (duration != null && (!Double.isFinite(duration.doubleValue())
            || duration.doubleValue() != Math.rint(duration.doubleValue())
            || duration.longValue() < 1 || duration.longValue() > 300000)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Voice duration must be 1 to 300000 milliseconds");
        }
    }

    public VoiceAudio load(Long fileId, Long sessionId) {
        if (CurrentUserHolder.getLoginInfo() == null || CurrentUserHolder.getCurrentUserId() == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Authentication required");
        }
        if (fileId == null || fileId <= 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "fileId is required");
        }
        Files file = files.findById(fileId);
        if (file == null || !Objects.equals(file.getCreateBy(), CurrentUserHolder.getCurrentUserId())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Voice file not found");
        }
        if (sessionId != null && !Objects.equals(sessionId, file.getChatId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Voice file does not belong to session");
        }
        String name = file.getConvertFileName() == null ? file.getFileName() : file.getConvertFileName();
        if (name == null || name.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 512
            || !name.toLowerCase(java.util.Locale.ROOT).endsWith(".mp3")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Voice file must be MP3");
        }
        if (file.getLength() != null && file.getLength() > MAX_AUDIO_BYTES) {
            throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "Voice file exceeds 12 MB");
        }
        try {
            var reference = UriComponentsBuilder.fromUriString(file.getFileUrl()).build();
            if (!"/commonFile/preview".equals(reference.getPath()) || reference.getHost() != null) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid uploaded voice reference");
            }
            String bucket = reference.getQueryParams().getFirst("bucketName");
            String path = reference.getQueryParams().getFirst("filePath");
            if (path == null || path.isBlank()) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid uploaded voice reference");
            }
            try (InputStream stream = storage.openCommonFileInputStream(bucket, path)) {
                byte[] audio = stream.readNBytes(MAX_AUDIO_BYTES + 1);
                if (audio.length > MAX_AUDIO_BYTES) {
                    throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "Voice file exceeds 12 MB");
                }
                if (!isMp3(audio)) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid MP3 audio");
                }
                return new VoiceAudio(fileId, file.getChatId(), name, audio);
            }
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Voice file could not be read");
        }
    }

    /** Persist only validated voice metadata; never trust client supplied bytes, paths, or transcripts. */
    public void prepareChat(AssistantChatDto request) {
        Map<String, Object> ext = request.getExtParams();
        if (ext == null || !(ext.get("voice") instanceof Map<?, ?> voice)) return;
        Map<String, Object> metadata = outbound(voice, request.getSessionId());
        metadata.remove("audioBase64");
        Map<String, Object> sanitized = new LinkedHashMap<>(ext);
        sanitized.remove("audioBase64");
        sanitized.put("voice", metadata);
        sanitized.put("messageType", "VOICE");
        request.setExtParams(sanitized);
        JSONObject persisted = request.getMetadata() == null || request.getMetadata().isBlank()
            ? new JSONObject() : JSON.parseObject(request.getMetadata());
        persisted.remove("audioBase64");
        persisted.remove("voice");
        persisted.remove("messageType");
        request.setMetadata(persisted.toJSONString());
    }

    /** Build a new outbound payload so raw bytes never enter persisted chat metadata. */
    public Map<String, Object> outbound(Map<?, ?> voice, Long sessionId) {
        Long fileId;
        try {
            fileId = Long.valueOf(String.valueOf(voice.get("fileId")));
        } catch (NumberFormatException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "voice.fileId is required");
        }
        VoiceAudio audio = load(fileId, sessionId);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("fileId", String.valueOf(audio.fileId()));
        result.put("fileName", audio.fileName());
        result.put("mimeType", "audio/mpeg");
        if (voice.containsKey("durationMs")) {
            Object value = voice.get("durationMs");
            if (!(value instanceof Number duration)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Voice duration must be 1 to 300000 milliseconds");
            }
            validateDuration(duration);
            result.put("durationMs", ((Number) value).longValue());
        }
        result.put("audioBase64", Base64.getEncoder().encodeToString(audio.bytes()));
        return result;
    }

    private boolean isMp3(byte[] audio) {
        return audio.length >= 3 && ((audio[0] == 'I' && audio[1] == 'D' && audio[2] == '3')
            || ((audio[0] & 0xff) == 0xff && (audio[1] & 0xe0) == 0xe0));
    }

    public record VoiceAudio(Long fileId, Long sessionId, String fileName, byte[] bytes) {
    }
}
