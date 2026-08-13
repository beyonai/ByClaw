package com.iwhalecloud.byai.manager.dto.usermcp;

import java.util.List;
import java.util.Date;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.iwhalecloud.byai.manager.domain.usermcp.UserMcpToolDiscoveryService.ToolView;

public record UserMcpServiceDto(
    Long resourceId,
    String resourceCode,
    String resourceName,
    String resourceDesc,
    String sourceContent,
    Long definitionRevision,
    String endpointFingerprint,
    Long snapshotVersion,
    List<ToolView> tools,
    String enableFlag,
    String credentialState,
    boolean connected,
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss") Date lastVerifiedAt
) {
    public UserMcpServiceDto(
            Long resourceId,
            String resourceCode,
            String resourceName,
            String resourceDesc,
            String sourceContent,
            Long definitionRevision,
            String endpointFingerprint,
            Long snapshotVersion,
            List<ToolView> tools) {
        this(resourceId, resourceCode, resourceName, resourceDesc, sourceContent, definitionRevision,
            endpointFingerprint, snapshotVersion, tools, null, null, false, null);
    }
}
