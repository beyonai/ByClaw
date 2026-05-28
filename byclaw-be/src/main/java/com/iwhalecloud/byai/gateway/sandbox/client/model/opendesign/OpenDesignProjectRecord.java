package com.iwhalecloud.byai.gateway.sandbox.client.model.opendesign;

import java.util.Map;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import lombok.Data;

@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class OpenDesignProjectRecord {

    private String id;

    private String name;

    private String skillId;

    private String designSystemId;

    private String pendingPrompt;

    private Map<String, Object> metadata;

    private Long createdAt;

    private Long updatedAt;
}
