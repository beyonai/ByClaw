package com.iwhalecloud.byai.manager.domain.usermcp;

import java.util.Arrays;
import java.util.Set;
import java.util.function.Supplier;
import java.util.stream.Collectors;

import com.iwhalecloud.byai.manager.domain.staticdata.service.SystemConfigService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

/** Administrator-owned exact READ rules, formatted as endpointFingerprint:toolName. */
@Component
public class UserMcpToolRiskPolicy {

    private static final String READ_TOOL_RULES_PARAM = "BYAI_MCP_READ_TOOL_RULES";

    private final Supplier<String> configuredRules;

    @Autowired
    public UserMcpToolRiskPolicy(SystemConfigService systemConfigService) {
        this(() -> systemConfigService.getStringParamValueByCode(READ_TOOL_RULES_PARAM));
    }

    UserMcpToolRiskPolicy(String configured) {
        this(() -> configured);
    }

    private UserMcpToolRiskPolicy(Supplier<String> configuredRules) {
        this.configuredRules = configuredRules;
    }

    private Set<String> readRules() {
        String configured = configuredRules.get();
        return StringUtils.hasText(configured)
            ? Arrays.stream(configured.split(",")).map(String::trim).filter(StringUtils::hasText).collect(Collectors.toSet())
            : Set.of();
    }

    public String classify(String endpointFingerprint, String toolName) {
        return endpointFingerprint != null && toolName != null && readRules().contains(endpointFingerprint + ":" + toolName)
            ? "READ" : "UNKNOWN";
    }
}
