package com.iwhalecloud.byai.gateway.sandbox.client.model;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.OffsetDateTime;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class SandboxStatus {

    private String state;

    private String reason;

    private String message;

    private OffsetDateTime lastTransitionAt;
}
