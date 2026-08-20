package com.iwhalecloud.byai.state.interfaces.controller.artifact;

import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.domain.artifact.dto.ArtifactDataCreateRequest;
import com.iwhalecloud.byai.state.domain.artifact.dto.ArtifactDataRecordDto;
import com.iwhalecloud.byai.state.domain.artifact.dto.ArtifactDataUpdateRequest;
import com.iwhalecloud.byai.state.domain.artifact.service.ArtifactDataRecordService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Capability-protected JSON persistence endpoints used by shared HTML Artifact pages.
 */
@RestController
@RequestMapping("${artifact.data.path-prefix:/artifact-data}/{artifactId}/{accessKey}/records")
public class ArtifactDataContentController {

    private final ArtifactDataRecordService artifactDataRecordService;

    public ArtifactDataContentController(ArtifactDataRecordService artifactDataRecordService) {
        this.artifactDataRecordService = artifactDataRecordService;
    }

    @PostMapping
    public ResponseUtil<ArtifactDataRecordDto> create(@PathVariable("artifactId") String artifactId,
        @PathVariable("accessKey") String accessKey, @Valid @RequestBody ArtifactDataCreateRequest request) {
        return ResponseUtil.successResponse(artifactDataRecordService.createPublic(artifactId, accessKey, request));
    }

    @GetMapping("/{recordKey}")
    public ResponseUtil<ArtifactDataRecordDto> get(@PathVariable("artifactId") String artifactId,
        @PathVariable("accessKey") String accessKey, @PathVariable("recordKey") String recordKey) {
        return ResponseUtil.successResponse(artifactDataRecordService.getPublic(artifactId, accessKey, recordKey));
    }

    @PutMapping("/{recordKey}")
    public ResponseUtil<ArtifactDataRecordDto> update(@PathVariable("artifactId") String artifactId,
        @PathVariable("accessKey") String accessKey, @PathVariable("recordKey") String recordKey,
        @Valid @RequestBody ArtifactDataUpdateRequest request) {
        return ResponseUtil.successResponse(
            artifactDataRecordService.updatePublic(artifactId, accessKey, recordKey, request));
    }
}
