package com.iwhalecloud.byai.state.interfaces.controller.artifact;

import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.domain.artifact.dto.ArtifactContentUpdateDto;
import com.iwhalecloud.byai.state.domain.artifact.dto.ArtifactDto;
import com.iwhalecloud.byai.state.domain.artifact.dto.ArtifactExpiryRenewRequest;
import com.iwhalecloud.byai.state.domain.artifact.model.ArtifactPublishMode;
import com.iwhalecloud.byai.state.domain.artifact.service.ArtifactApplicationService;
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

    public ArtifactController(ArtifactApplicationService artifactApplicationService) {
        this.artifactApplicationService = artifactApplicationService;
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

    @PutMapping(value = "/{artifactId}/content", consumes = MediaType.MULTIPART_FORM_DATA_VALUE,
        produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "替换本人Artifact内容")
    public ArtifactContentUpdateDto replaceContent(@PathVariable("artifactId") String artifactId,
        @RequestPart("file") MultipartFile file,
        @RequestParam(value = "publishMode", defaultValue = "AUTO") ArtifactPublishMode publishMode,
        @RequestParam(value = "entryPoint", required = false) String entryPoint,
        @RequestParam(value = "stripTopLevelDirectory", defaultValue = "true") boolean stripTopLevelDirectory,
        @RequestParam(value = "displayName", required = false) String displayName,
        @RequestParam(value = "sha256", required = false) String sha256) {
        return artifactApplicationService.replaceOwnedContent(artifactId, file, publishMode, entryPoint,
            stripTopLevelDirectory, displayName, sha256);
    }

    @GetMapping("/{artifactId}")
    @Operation(summary = "查询本人Artifact元数据")
    public ResponseUtil<ArtifactDto> get(@PathVariable("artifactId") String artifactId) {
        return ResponseUtil.successResponse(artifactApplicationService.getOwned(artifactId));
    }

    @PutMapping("/{artifactId}/expiration")
    @Operation(summary = "续约本人Artifact的公开访问有效期")
    public ResponseUtil<ArtifactDto> renewExpiration(@PathVariable("artifactId") String artifactId,
        @Valid @RequestBody ArtifactExpiryRenewRequest request) {
        return ResponseUtil.successResponse(
            artifactApplicationService.renewOwnedExpiration(artifactId, request.getExpiresInSeconds()));
    }

    @DeleteMapping("/{artifactId}")
    @Operation(summary = "撤销并删除本人Artifact")
    public ResponseUtil<Void> delete(@PathVariable("artifactId") String artifactId) {
        artifactApplicationService.deleteOwned(artifactId);
        return ResponseUtil.successResponse();
    }

}
