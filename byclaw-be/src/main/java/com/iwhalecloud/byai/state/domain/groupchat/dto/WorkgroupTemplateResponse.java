package com.iwhalecloud.byai.state.domain.groupchat.dto;

import java.util.List;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiWorkgroupTemplate;
import com.iwhalecloud.byai.manager.dto.orchestrator.OrchestratorRuntimeDTO;
import lombok.Data;

@Data
public class WorkgroupTemplateResponse {
    private ByaiWorkgroupTemplate template;
    private String catalogName;
    private List<Resource> resources;
    private List<OrchestratorRuntimeDTO.Agent> employees;
    private boolean available = true;
    private String unavailableReason;

    @Data
    public static class Resource {
        private String resourceId;
        private String resourceName;
        private String resourceType;
        private String avatar;
        private String resourceVersion;
        private List<OrchestratorRuntimeDTO.Agent> employees;
    }
}
