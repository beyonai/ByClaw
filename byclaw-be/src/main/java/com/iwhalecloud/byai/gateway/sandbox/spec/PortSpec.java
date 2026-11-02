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
    /** Optional endpoint network: private or public. Null preserves the provider default. */
    @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
    private String exposure;

    public void setExposure(String exposure) {
        if (exposure != null && !"private".equals(exposure) && !"public".equals(exposure))
            throw new IllegalArgumentException("ports[].exposure must be private or public");
        this.exposure = exposure;
    }
}
