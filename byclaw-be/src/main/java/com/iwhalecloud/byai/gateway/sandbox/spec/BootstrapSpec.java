package com.iwhalecloud.byai.gateway.sandbox.spec;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.Data;

@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class BootstrapSpec {

    /**
     * Optional template copy operation used to prepare per-user workspace.
     */
    private CopyTemplateOp copyTemplate;

    /**
     * Identity json file template.
     * Default: ${workspace_host}/identity/by_user_info.json
     */
    private String identityFilePathTemplate;
}

