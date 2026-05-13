package com.iwhalecloud.byai.gateway.sandbox.client.model;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class SandboxEndpoint {

    private String endpoint;

    private Map<String, String> headers;
}
