package com.iwhalecloud.byai.gateway.sandbox.controller.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class SandboxLaunchData {

    private List<String> endpoints;

    private Map<String, String> instanceEndpoints;

    private String endpoint;
}
