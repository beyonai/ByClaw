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

    /**
     * Optional numeric user ID to apply to the volume target.
     */
    private Integer uid;

    /**
     * Optional numeric group ID to apply to the volume target.
     */
    private Integer gid;

    /**
     * Optional POSIX permission mode, for example {@code 0770}.
     * Kept as a string so leading zeroes are preserved during JSON binding.
     */
    private String mode;
}
