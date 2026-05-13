package com.iwhalecloud.byai.gateway.sandbox.spec;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.Data;

@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class PortSpec {
    private Integer port;

    /**
     * "http" or "https" (optional).
     * Endpoint from OpenSandbox may already contain scheme; if not, processor can apply this.
     */
    private String protocol;
}

