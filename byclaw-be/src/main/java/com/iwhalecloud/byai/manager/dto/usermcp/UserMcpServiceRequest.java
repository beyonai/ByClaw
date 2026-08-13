package com.iwhalecloud.byai.manager.dto.usermcp;

import com.iwhalecloud.byai.manager.dto.connector.McpCredentialInput;

public record UserMcpServiceRequest(
    String resourceCode,
    String resourceName,
    String resourceDesc,
    String sourceContent,
    McpCredentialInput credentialInput
) {
    @Override
    public String toString() {
        return "UserMcpServiceRequest[resourceCode=" + resourceCode + ", resourceName=" + resourceName
            + ", credentialInput=<redacted>]";
    }
}
