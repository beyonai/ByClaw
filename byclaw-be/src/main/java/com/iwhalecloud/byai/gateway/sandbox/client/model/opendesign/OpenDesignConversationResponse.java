package com.iwhalecloud.byai.gateway.sandbox.client.model.opendesign;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import lombok.Data;

@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class OpenDesignConversationResponse {

    private OpenDesignConversationRecord conversation;
}
