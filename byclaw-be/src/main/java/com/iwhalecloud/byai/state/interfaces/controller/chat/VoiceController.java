package com.iwhalecloud.byai.state.interfaces.controller.chat;

import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.application.service.asr.HarnessMediaClient;
import com.iwhalecloud.byai.state.application.service.asr.VoiceAudioService;
import java.util.Map;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/asr")
public class VoiceController {
    private final VoiceAudioService audio;
    private final HarnessMediaClient asr;

    public VoiceController(VoiceAudioService audio, HarnessMediaClient asr) {
        this.audio = audio;
        this.asr = asr;
    }

    @PostMapping("/transcribe")
    public ResponseUtil<Map<String, Object>> transcribe(@RequestBody TranscribeRequest request) {
        if (request == null || (request.fileId() != null && request.path() != null)
            || (request.fileId() == null && (request.sessionId() == null || request.path() == null))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Provide either fileId or sessionId and path");
        }
        VoiceAudioService.validateDuration(request.durationMs());
        var source = request.fileId() != null ? audio.load(request.fileId(), request.sessionId())
            : audio.loadArtifact(request.sessionId(), request.path());
        return ResponseUtil.successResponse(asr.transcribe(source, null));
    }

    @GetMapping("/audio")
    public ResponseEntity<byte[]> audio(@RequestParam("fileId") Long fileId) {
        return ResponseEntity.ok().contentType(MediaType.parseMediaType("audio/mpeg"))
            .cacheControl(CacheControl.noStore()).header("X-Content-Type-Options", "nosniff")
            .body(audio.load(fileId, null).bytes());
    }

    public record TranscribeRequest(Long fileId, Long sessionId, String path, Number durationMs) {
        public TranscribeRequest(Long fileId, Long sessionId) {
            this(fileId, sessionId, null, null);
        }

        public TranscribeRequest(Long fileId, Long sessionId, String path) {
            this(fileId, sessionId, path, null);
        }
    }
}
