package com.iwhalecloud.byai.gateway.sandbox.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.gateway.sandbox.mapper.SandboxServiceSpecEntityMapper;
import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformRemoteGateway;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/** Authenticated, credential-free view of the admitted tool environment catalog. */
@RestController
@RequestMapping("/sandbox/toolTemplates")
public class ToolSandboxMarketController {
    private final SandboxServiceSpecEntityMapper specs;
    private final PlatformRemoteGateway platform;
    private final ObjectMapper json = new ObjectMapper();

    public ToolSandboxMarketController(SandboxServiceSpecEntityMapper specs, PlatformRemoteGateway platform) {
        this.specs = specs;
        this.platform = platform;
    }

    @PostMapping
    public ResponseUtil list() {
        String user = CurrentUserHolder.getCurrentUserCode();
        if (user == null || user.isBlank()) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        List<Map<String, Object>> result = new ArrayList<>();
        for (String purpose : List.of("browser", "media")) {
            String key = "byclaw-tools-" + purpose;
            var row = specs.selectProfileAwareByServiceKey(key);
            if (row == null || !Integer.valueOf(1).equals(row.getEnabled()) || !"USER".equals(row.getOwnerScope())) continue;
            try {
                JsonNode spec = json.readTree(row.getSpecJson());
                JsonNode metadata = spec.path("runtimeOptions").path("toolSandbox");
                if (!"byclaw.tool-sandbox/v1".equals(metadata.path("contract").asText())) continue;
                JsonNode capabilities = metadata.path("capabilities");
                if (capabilities.isTextual()) capabilities = json.readTree(capabilities.asText());
                List<String> names = new ArrayList<>();
                if (capabilities.isArray()) for (JsonNode capability : capabilities) {
                    if (capability.isTextual() && capability.asText().matches("[a-z][a-z0-9_.-]{0,80}")) names.add(capability.asText());
                }
                String state = "UNKNOWN";
                if (platform.isRemote()) {
                    ResponseUtil response = platform.controller("templateRebuild/records",
                        Map.of("serviceKey", key, "pageNo", 1, "pageSize", 1));
                    if (ResponseUtil.SUCCESS == response.getCode()) {
                        JsonNode status = json.valueToTree(response.getData()).findValue("state");
                        if (status != null) state = status.asText();
                    }
                }
                Map<String, Object> view = new LinkedHashMap<>();
                view.put("templateKey", purpose);
                view.put("serviceKey", key);
                view.put("displayName", row.getDisplayName() == null ? key : row.getDisplayName());
                view.put("imageTag", metadata.path("imageTag").asText());
                view.put("capabilities", names);
                view.put("operations", Map.of("protocol", "ssh", "exposure", "private"));
                view.put("displayAvailable", false);
                view.put("buildStatus", state);
                view.put("ready", "SUCCEEDED".equals(state));
                result.add(view);
            } catch (Exception unavailable) {
                // Malformed or unreachable entries are not silently admitted.
            }
        }
        return ResponseUtil.successResponse(result);
    }
}
