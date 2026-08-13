package com.iwhalecloud.byai.manager.dto.usermcp;

import java.util.Map;

public record UserMcpToolCallRequest(Long snapshotVersion, Map<String, Object> arguments) {
}
