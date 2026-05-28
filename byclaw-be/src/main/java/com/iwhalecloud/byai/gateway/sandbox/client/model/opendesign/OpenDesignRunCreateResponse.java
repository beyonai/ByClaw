package com.iwhalecloud.byai.gateway.sandbox.client.model.opendesign;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import lombok.Data;

@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class OpenDesignRunCreateResponse {

    private String runId;

    private String appliedPluginSnapshotId;

    private String pluginId;
}
