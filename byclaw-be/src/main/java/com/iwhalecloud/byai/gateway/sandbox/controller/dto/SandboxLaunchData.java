package com.iwhalecloud.byai.gateway.sandbox.controller.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class SandboxLaunchData {

    private List<String> endpoints;

    private String endpoint;
}
