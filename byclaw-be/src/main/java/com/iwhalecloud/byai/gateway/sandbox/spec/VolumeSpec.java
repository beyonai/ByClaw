package com.iwhalecloud.byai.gateway.sandbox.spec;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.Data;

@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class VolumeSpec {
    /**
     * volume key
     */
    private String key;

    /**
     * PUBLIC shared or PRIVATE per-user.
     */
    private VolumeScope scope;

    /**
     * Host path template.
     * - Must be compatible with placeholder rendering (e.g. ${user_code}, ${service_key}, ${workspace_host}).
     */
    private String hostPath;

    /**
     * Container mount path.
     */
    private String mountPath;

    /**
     * readOnly flag for this mount.
     */
    private Boolean readOnly;

    /**
     * Optional subPath.
     */
    private String subPath;
}

