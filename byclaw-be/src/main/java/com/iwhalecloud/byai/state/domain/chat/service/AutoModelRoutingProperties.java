package com.iwhalecloud.byai.state.domain.chat.service;

import java.util.ArrayList;
import java.util.List;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/** Routing annotations reference existing model IDs; credentials stay in model management. */
@Getter
@Setter
@Component
@ConfigurationProperties(prefix = "byclaw.auto-model-routing")
public class AutoModelRoutingProperties {
    private boolean enabled;
    private String apiKey = "";
    private String policyVersion = "auto-v2";
    private int timeoutMs = 5000;
    private double minChoiceProbability = 0.75;
    private double minChoiceMargin = 0.20;
    private double minConfidence = 0.60;
    private List<Candidate> candidates = new ArrayList<>();
    private List<String> fallbackModelIds = new ArrayList<>();

    @Getter
    @Setter
    public static class Candidate {
        private String modelId;
        private String description = "";
        private List<String> capabilities = new ArrayList<>();
        private int priority = 100;
    }
}
