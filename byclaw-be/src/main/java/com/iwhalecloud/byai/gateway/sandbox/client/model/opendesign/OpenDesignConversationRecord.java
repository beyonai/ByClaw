package com.iwhalecloud.byai.gateway.sandbox.client.model.opendesign;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import lombok.Data;

@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class OpenDesignConversationRecord {

    private String id;

    private String projectId;

    private String title;

    private Long createdAt;

    private Long updatedAt;
}
