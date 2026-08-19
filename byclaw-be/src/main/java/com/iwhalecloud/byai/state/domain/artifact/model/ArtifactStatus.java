package com.iwhalecloud.byai.state.domain.artifact.model;

/**
 * Artifact lifecycle states used to hide incomplete storage prefixes from readers.
 */
public enum ArtifactStatus {
    UPLOADING,
    READY,
    FAILED,
    DELETING,
    DELETED
}
