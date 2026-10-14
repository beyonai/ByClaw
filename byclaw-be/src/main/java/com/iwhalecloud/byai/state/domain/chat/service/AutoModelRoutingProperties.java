package com.iwhalecloud.byai.state.domain.chat.service;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/** Auto is always available; candidates come from existing model management. */
@Getter
@Setter
@Component
@ConfigurationProperties(prefix = "byclaw.auto-model-routing")
public class AutoModelRoutingProperties {
    private String policyVersion = "auto-v3";
    private int timeoutMs = 5000;
    private double minChoiceProbability = 0.75;
    private double minChoiceMargin = 0.20;
    private double minConfidence = 0.60;
}
