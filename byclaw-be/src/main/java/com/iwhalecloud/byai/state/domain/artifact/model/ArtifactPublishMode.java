package com.iwhalecloud.byai.state.domain.artifact.model;

/**
 * Controls whether an upload is exposed as a site, inline file, or download only.
 */
public enum ArtifactPublishMode {
    AUTO,
    SITE,
    FILE,
    DOWNLOAD_ONLY
}
