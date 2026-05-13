package com.iwhalecloud.byai.gateway.sandbox.spec;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.Data;

import java.util.List;

@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class StartupSpec {

    /**
     * CreateSandboxRequest.entrypoint.
     * The list form avoids ambiguous splitting rules.
     */
    private List<String> entrypoint;
}

