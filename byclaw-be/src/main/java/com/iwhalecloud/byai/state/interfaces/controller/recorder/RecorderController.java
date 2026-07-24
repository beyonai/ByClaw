package com.iwhalecloud.byai.state.interfaces.controller.recorder;

import com.iwhalecloud.byai.state.application.service.recorder.RecorderApplicationService;
import com.iwhalecloud.byai.state.application.service.recorder.RecorderResponse;
import com.iwhalecloud.byai.state.domain.recorder.model.RecorderEnvelope;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/recorder")
public class RecorderController {

    private final RecorderApplicationService recorderApplicationService;

    public RecorderController(RecorderApplicationService recorderApplicationService) {
        this.recorderApplicationService = recorderApplicationService;
    }

    @GetMapping("/health")
    public ResponseEntity<RecorderEnvelope<Map<String, Object>>> health() {
        return response(recorderApplicationService.health());
    }

    @GetMapping("/requests/{requestId}")
    public ResponseEntity<RecorderEnvelope<Map<String, Object>>> requestStatus(@PathVariable String requestId) {
        return response(recorderApplicationService.requestStatus(requestId));
    }

    @PostMapping("/session/bind")
    public ResponseEntity<RecorderEnvelope<Map<String, Object>>> bind(@RequestBody(required = false) Map<String, Object> body) {
        return response(recorderApplicationService.bind(normalize(body)));
    }

    @PostMapping("/session/confirm-auth")
    public ResponseEntity<RecorderEnvelope<Map<String, Object>>> confirmAuth(@RequestBody(required = false) Map<String, Object> body) {
        return response(recorderApplicationService.confirmAuth(normalize(body)));
    }

    @PostMapping("/navigate")
    public ResponseEntity<RecorderEnvelope<Map<String, Object>>> navigate(@RequestBody(required = false) Map<String, Object> body) {
        return response(recorderApplicationService.navigate(normalize(body)));
    }

    @PostMapping("/capture/start")
    public ResponseEntity<RecorderEnvelope<Map<String, Object>>> captureStart(@RequestBody(required = false) Map<String, Object> body) {
        return response(recorderApplicationService.captureStart(normalize(body)));
    }

    @PostMapping("/capture/read")
    public ResponseEntity<RecorderEnvelope<Map<String, Object>>> captureRead(@RequestBody(required = false) Map<String, Object> body) {
        return response(recorderApplicationService.captureRead(normalize(body)));
    }

    @PostMapping("/screenshot")
    public ResponseEntity<RecorderEnvelope<Map<String, Object>>> screenshot(@RequestBody(required = false) Map<String, Object> body) {
        return response(recorderApplicationService.screenshot(normalize(body)));
    }

    @PostMapping("/input")
    public ResponseEntity<RecorderEnvelope<Map<String, Object>>> input(@RequestBody(required = false) Map<String, Object> body) {
        return response(recorderApplicationService.input(normalize(body)));
    }

    @PostMapping("/rank")
    public ResponseEntity<RecorderEnvelope<Map<String, Object>>> rank(@RequestBody(required = false) Map<String, Object> body) {
        return response(recorderApplicationService.rank(normalize(body)));
    }

    @PostMapping("/analyze")
    public ResponseEntity<RecorderEnvelope<Map<String, Object>>> analyze(@RequestBody(required = false) Map<String, Object> body) {
        return response(recorderApplicationService.analyze(normalize(body)));
    }

    @PostMapping("/init")
    public ResponseEntity<RecorderEnvelope<Map<String, Object>>> init(@RequestBody(required = false) Map<String, Object> body) {
        return response(recorderApplicationService.init(normalize(body)));
    }

    @PostMapping("/verify")
    public ResponseEntity<RecorderEnvelope<Map<String, Object>>> verify(@RequestBody(required = false) Map<String, Object> body) {
        return response(recorderApplicationService.verify(normalize(body)));
    }

    @PostMapping("/pipeline")
    public ResponseEntity<RecorderEnvelope<Map<String, Object>>> pipeline(@RequestBody(required = false) Map<String, Object> body) {
        return response(recorderApplicationService.pipeline(normalize(body)));
    }

    @PostMapping("/pipeline/preview")
    public ResponseEntity<RecorderEnvelope<Map<String, Object>>> pipelinePreview(@RequestBody(required = false) Map<String, Object> body) {
        return response(recorderApplicationService.pipelinePreview(normalize(body)));
    }

    @PostMapping("/pipeline/score")
    public ResponseEntity<RecorderEnvelope<Map<String, Object>>> pipelineScore(@RequestBody(required = false) Map<String, Object> body) {
        return response(recorderApplicationService.pipelineScore(normalize(body)));
    }

    @PostMapping("/pipeline/generate")
    public ResponseEntity<RecorderEnvelope<Map<String, Object>>> pipelineGenerate(@RequestBody(required = false) Map<String, Object> body) {
        return response(recorderApplicationService.pipelineGenerate(normalize(body)));
    }

    @PostMapping("/draft/verify")
    public ResponseEntity<RecorderEnvelope<Map<String, Object>>> draftVerify(@RequestBody(required = false) Map<String, Object> body) {
        return response(recorderApplicationService.draftVerify(normalize(body)));
    }

    @PostMapping("/save")
    public ResponseEntity<RecorderEnvelope<Map<String, Object>>> save(@RequestBody(required = false) Map<String, Object> body) {
        return response(recorderApplicationService.saveAdapter(normalize(body)));
    }

    @PostMapping("/cancel")
    public ResponseEntity<RecorderEnvelope<Map<String, Object>>> cancel(@RequestBody(required = false) Map<String, Object> body) {
        return response(recorderApplicationService.cancel(normalize(body)));
    }

    private ResponseEntity<RecorderEnvelope<Map<String, Object>>> response(RecorderResponse<Map<String, Object>> response) {
        return ResponseEntity.status(response.status()).body(response.body());
    }

    private Map<String, Object> normalize(Map<String, Object> body) {
        return body == null ? Map.of() : body;
    }
}
