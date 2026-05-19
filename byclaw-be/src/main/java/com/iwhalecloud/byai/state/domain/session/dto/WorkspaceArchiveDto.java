package com.iwhalecloud.byai.state.domain.session.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class WorkspaceArchiveDto {

    private Boolean exists;

    private String userCode;

    private Long resourceId;

    /**
     * ArchiveFS 外部路径，例如 /openclaw-workspace-archives/workspace-baiying-agent-100/cancel_auth_latest.tar.gz。
     */
    private String archivePath;

    /**
     * MinIO objectKey，例如 /openclaw-workspace-archives/workspace-baiying-agent-100/cancel_auth_latest.tar.gz。
     */
    private String objectKey;

    private String metadataPath;

    private String archiveKind;

    private Long fileSize;

    private String contentType;

    private String sha256;

    private String expectedSha256;

    private String fileTag;

    private String storageType;

    private String archivedAt;
}
