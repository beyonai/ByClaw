package com.iwhalecloud.byai.manager.domain.usermcp;

import java.util.List;
import java.util.Map;

public interface UserMcpRemoteClient {

    List<RemoteTool> discover(UserMcpPublicConfig config, Map<String, String> credentialHeaders);

    String call(
        UserMcpPublicConfig config,
        Map<String, String> credentialHeaders,
        String toolName,
        Map<String, Object> arguments);

    record RemoteTool(String name, String description, String inputSchema) {
    }
}
