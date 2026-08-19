package com.iwhalecloud.byai.state.domain.artifact.model;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

/**
 * Stores the control-plane metadata needed to resolve and revoke a published artifact.
 */
@Getter
@Setter
@TableName("byai_artifact")
public class ArtifactRecord {

    @TableId(value = "artifact_id", type = IdType.INPUT)
    private String artifactId;

    private Long ownerUserId;

    private String ownerUserCode;

    private String status;

    private String kind;

    private String storageType;

    private String storageRoot;

    private String storagePrefix;

    private String originalKey;

    private String contentPrefix;

    private String originalName;

    private String displayName;

    private String entryPoint;

    private String contentType;

    private Long fileSize;

    private Long expandedSize;

    private String sha256;

    private String accessKeyHash;

    private String warningsJson;

    private LocalDateTime expiresAt;

    private LocalDateTime createTime;

    private LocalDateTime updateTime;
}
