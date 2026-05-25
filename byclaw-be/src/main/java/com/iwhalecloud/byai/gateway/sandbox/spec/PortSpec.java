package com.iwhalecloud.byai.gateway.sandbox.spec;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.Data;

@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class PortSpec {
    private Integer port;

    /**
     * Logical service name inside the image, e.g. "openclaw".
     */
    private String instance;

    /**
     * "http" or "https" (optional).
     * Endpoint from OpenSandbox may already contain scheme; if not, processor can apply this.
     */
    private String protocol;
}
