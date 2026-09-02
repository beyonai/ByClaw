package com.iwhalecloud.byai.state.interfaces.controller.artifact;

import com.iwhalecloud.byai.common.page.PageInfo;
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
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * JSON persistence endpoints used by public HTML Artifact pages and their management experiences.
 */
@RestController
@RequestMapping("${artifact.data.path-prefix:/artifact-data}/{artifactId}/records")
public class ArtifactDataContentController {

    public static final String MANAGEMENT_ACCESS_KEY_HEADER = "Artifact-Access-Key";

    private final ArtifactDataRecordService artifactDataRecordService;

    public ArtifactDataContentController(ArtifactDataRecordService artifactDataRecordService) {
        this.artifactDataRecordService = artifactDataRecordService;
    }

    @PostMapping
    public ResponseUtil<ArtifactDataRecordDto> create(@PathVariable("artifactId") String artifactId,
        @Valid @RequestBody ArtifactDataCreateRequest request) {
        return ResponseUtil.successResponse(artifactDataRecordService.createPublic(artifactId, request));
    }

    @GetMapping
    public ResponseUtil<PageInfo<ArtifactDataRecordDto>> list(@PathVariable("artifactId") String artifactId,
        @RequestHeader(MANAGEMENT_ACCESS_KEY_HEADER) String accessKey,
        @RequestParam(value = "collectionName", required = false) String collectionName,
        @RequestParam(value = "pageNum", defaultValue = "1") int pageNum,
        @RequestParam(value = "pageSize", defaultValue = "20") int pageSize) {
        return ResponseUtil.successResponse(
            artifactDataRecordService.listPublic(artifactId, accessKey, collectionName, pageNum, pageSize));
    }

    @GetMapping("/{recordKey}")
    public ResponseUtil<ArtifactDataRecordDto> get(@PathVariable("artifactId") String artifactId,
        @PathVariable("recordKey") String recordKey) {
        return ResponseUtil.successResponse(artifactDataRecordService.getPublic(artifactId, recordKey));
    }

    @PutMapping("/{recordKey}")
    public ResponseUtil<ArtifactDataRecordDto> update(@PathVariable("artifactId") String artifactId,
        @PathVariable("recordKey") String recordKey,
        @Valid @RequestBody ArtifactDataUpdateRequest request) {
        return ResponseUtil.successResponse(artifactDataRecordService.updatePublic(artifactId, recordKey, request));
    }
}
