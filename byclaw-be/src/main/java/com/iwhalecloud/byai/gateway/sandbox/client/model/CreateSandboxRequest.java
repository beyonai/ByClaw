package com.iwhalecloud.byai.gateway.sandbox.client.model;

import java.util.List;
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
public class CreateSandboxRequest {

    private ImageSpec image;

    private Integer timeout;

    private Map<String, String> resourceLimits;

    private Map<String, String> env;

    private Map<String, String> metadata;

    private List<String> entrypoint;

    private List<Volume> volumes;

    private Map<String, String> extensions;
}
