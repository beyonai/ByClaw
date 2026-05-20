package com.iwhalecloud.byai.common.feign.response.sandbox;

import java.time.OffsetDateTime;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class SandboxRenewResult {

    /** OpenSandbox-compatible new absolute expiration time in RFC 3339 format. */
    private String expiresAt;

    public OffsetDateTime parseExpiresAt() {
        if (expiresAt == null || expiresAt.isBlank()) {
            return null;
        }
        return OffsetDateTime.parse(expiresAt.trim());
    }
}
