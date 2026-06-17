package com.iwhalecloud.byai.gateway.sandbox.client.model;

import java.util.Map;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
public class ResizeSandboxRequest {

    private Map<String, String> resourceRequests;

    private Map<String, String> resourceLimits;

    private String resizeType;

    private Map<String, String> metadata;
}
