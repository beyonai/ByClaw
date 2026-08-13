package com.iwhalecloud.byai.manager.dto.connector;

import com.fasterxml.jackson.annotation.JsonProperty;

public record McpCredentialInput(
    String type,
    @JsonProperty(access = JsonProperty.Access.WRITE_ONLY) String value
) {
    @Override
    public String toString() {
        return "McpCredentialInput[type=" + type + ", value=<redacted>]";
    }
}
