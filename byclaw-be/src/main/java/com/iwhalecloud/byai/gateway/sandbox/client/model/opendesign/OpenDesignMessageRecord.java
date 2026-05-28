package com.iwhalecloud.byai.gateway.sandbox.client.model.opendesign;

import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import lombok.Data;

@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class OpenDesignMessageRecord {

    private String id;

    private String role;

    private String content;

    private String runId;

    private String runStatus;

    private String agentId;

    private String agentName;

    private Long createdAt;

    private Long startedAt;

    private List<Map<String, Object>> attachments;

    private List<Object> events;
}
