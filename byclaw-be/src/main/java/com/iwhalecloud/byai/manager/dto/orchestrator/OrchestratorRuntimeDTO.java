package com.iwhalecloud.byai.manager.dto.orchestrator;

import java.util.ArrayList;
import java.util.List;
import lombok.Getter;
import lombok.Setter;

/**
 * 已完成用户验权和配置过滤的数字员工组运行快照。
 * DTO 只包含调度事实，不包含模型或数字员工执行凭证。
 *
 * @author qin.guoquan
 * @date 2026-08-10 17:38:38
 */
@Getter
@Setter
public class OrchestratorRuntimeDTO {

    private String schemaVersion;

    private Orchestrator orchestrator;

    private Prompt prompt;

    private String contextProfile;

    private Model model;

    private List<Agent> agents = new ArrayList<>();

    private String configVersion;

    @Getter
    @Setter
    public static class Orchestrator {
        private String id;
        private String kind;
        private String name;
    }

    @Getter
    @Setter
    public static class Prompt {
        private String content;
        private String version;
    }

    @Getter
    @Setter
    public static class Model {
        private String modelId;
        private String configVersion;
    }

    @Getter
    @Setter
    public static class Agent {
        private String id;
        private String resourceCode;
        private String name;
        private String description;
        private String teamRole;
        private String createType;
        private String integrationType;
        private String agentType;
    }
}
