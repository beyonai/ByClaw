package com.iwhalecloud.byai.gateway.sandbox.spec;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.Data;

@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class PortSpec {
    private java.util.Map<String, String> presentation;
    public void setPresentation(Object value) {
        presentation = null;
        if (!(value instanceof java.util.Map)) {
            if (value != null) org.slf4j.LoggerFactory.getLogger(PortSpec.class).warn("Invalid optional instance presentation; viewer disabled");
            return;
        }
        java.util.Map<?, ?> raw = (java.util.Map<?, ?>) value;
        if (!(raw.get("viewer") instanceof String)) {
            org.slf4j.LoggerFactory.getLogger(PortSpec.class).warn("Invalid optional instance viewer; viewer disabled");
            return;
        }
        presentation = new java.util.LinkedHashMap<>();
        presentation.put("viewer", (String) raw.get("viewer"));
        if (raw.get("label") instanceof String) presentation.put("label", (String) raw.get("label"));
    }

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
