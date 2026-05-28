package com.iwhalecloud.byai.gateway.sandbox.client.model.opendesign;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import lombok.Data;

@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class OpenDesignConversationsResponse {

    private List<OpenDesignConversationRecord> conversations;
}
