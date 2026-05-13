package com.iwhalecloud.byai.gateway.sandbox.spec;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.Data;

@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class CopyTemplateOp {
    /**
     * target to the volume hostPath
     */
    private String targetVolumeKey;

    /**
     * Target path template for workspace host root.
     * Examples:
     * - /data/templates/${user_code}/workspace
     * - ${workspace_parent}/${user_code}/workspace
     */
    private String targetPathTemplate;

    /**
     * When true, copy will only happen if target does not exist (best-effort).
     */
    private Boolean copyIfMissing = true;
}

