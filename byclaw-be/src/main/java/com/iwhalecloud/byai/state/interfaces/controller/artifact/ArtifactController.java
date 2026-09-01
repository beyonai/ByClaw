package com.iwhalecloud.byai.state.interfaces.controller.artifact;

import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.domain.artifact.dto.ArtifactDataCreateRequest;
import com.iwhalecloud.byai.state.domain.artifact.dto.ArtifactDataRecordDto;
import com.iwhalecloud.byai.state.domain.artifact.dto.ArtifactDataUpdateRequest;
import com.iwhalecloud.byai.state.domain.artifact.dto.ArtifactDto;
import com.iwhalecloud.byai.state.domain.artifact.model.ArtifactPublishMode;
import com.iwhalecloud.byai.state.domain.artifact.service.ArtifactApplicationService;
import com.iwhalecloud.byai.state.domain.artifact.service.ArtifactDataRecordService;
import jakarta.validation.Valid;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/**
 * Authenticated Artifact publication and owner-management API for sandbox agent harnesses.
 */
@RestController
@RequestMapping("/open/api/v1/artifacts")
@Tag(name = "Artifact发布", description = "Agent Harness上传、查询和撤销预览Artifact")
public class ArtifactController {

    private final ArtifactApplicationService artifactApplicationService;
    private final ArtifactDataRecordService artifactDataRecordService;

    public ArtifactController(ArtifactApplicationService artifactApplicationService,
        ArtifactDataRecordService artifactDataRecordService) {
        this.artifactApplicationService = artifactApplicationService;
        this.artifactDataRecordService = artifactDataRecordService;
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "上传并发布Artifact")
    public ResponseUtil<ArtifactDto> publish(@RequestPart("file") MultipartFile file,
        @RequestParam(value = "publishMode", defaultValue = "AUTO") ArtifactPublishMode publishMode,
        @RequestParam(value = "entryPoint", required = false) String entryPoint,
        @RequestParam(value = "stripTopLevelDirectory", defaultValue = "true") boolean stripTopLevelDirectory,
        @RequestParam(value = "expiresInSeconds", required = false) Long expiresInSeconds,
        @RequestParam(value = "displayName", required = false) String displayName,
        @RequestParam(value = "sha256", required = false) String sha256) {
        ArtifactDto result = artifactApplicationService.publish(file, publishMode, entryPoint,
            stripTopLevelDirectory, expiresInSeconds, displayName, sha256);
        return ResponseUtil.successResponse(result);
    }

    @GetMapping("/{artifactId}")
    @Operation(summary = "查询本人Artifact元数据")
    public ResponseUtil<ArtifactDto> get(@PathVariable("artifactId") String artifactId) {
        return ResponseUtil.successResponse(artifactApplicationService.getOwned(artifactId));
    }

    @DeleteMapping("/{artifactId}")
    @Operation(summary = "撤销并删除本人Artifact")
    public ResponseUtil<Void> delete(@PathVariable("artifactId") String artifactId) {
        artifactApplicationService.deleteOwned(artifactId);
        return ResponseUtil.successResponse();
    }

    @PostMapping("/{artifactId}/data-records")
    @Operation(summary = "为本人Artifact创建JSON数据记录")
    public ResponseUtil<ArtifactDataRecordDto> createDataRecord(@PathVariable("artifactId") String artifactId,
        @Valid @RequestBody ArtifactDataCreateRequest request) {
        return ResponseUtil.successResponse(artifactDataRecordService.createOwned(artifactId, request));
    }

    @GetMapping("/{artifactId}/data-records")
    @Operation(summary = "分页查询本人Artifact的JSON数据记录")
    public ResponseUtil<PageInfo<ArtifactDataRecordDto>> listDataRecords(
        @PathVariable("artifactId") String artifactId,
        @RequestParam(value = "collectionName", required = false) String collectionName,
        @RequestParam(value = "pageNum", defaultValue = "1") int pageNum,
        @RequestParam(value = "pageSize", defaultValue = "20") int pageSize) {
        return ResponseUtil.successResponse(
            artifactDataRecordService.listOwned(artifactId, collectionName, pageNum, pageSize));
    }

    @GetMapping("/{artifactId}/data-records/{recordKey}")
    @Operation(summary = "按recordKey查询本人Artifact数据记录")
    public ResponseUtil<ArtifactDataRecordDto> getDataRecord(@PathVariable("artifactId") String artifactId,
        @PathVariable("recordKey") String recordKey) {
        return ResponseUtil.successResponse(artifactDataRecordService.getOwned(artifactId, recordKey));
    }

    @PutMapping("/{artifactId}/data-records/{recordKey}")
    @Operation(summary = "按recordKey更新本人Artifact数据记录")
    public ResponseUtil<ArtifactDataRecordDto> updateDataRecord(@PathVariable("artifactId") String artifactId,
        @PathVariable("recordKey") String recordKey, @Valid @RequestBody ArtifactDataUpdateRequest request) {
        return ResponseUtil.successResponse(artifactDataRecordService.updateOwned(artifactId, recordKey, request));
    }
}
