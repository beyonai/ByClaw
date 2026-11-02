package com.iwhalecloud.byai.state.aspect;

import static org.assertj.core.api.Assertions.assertThat;

import com.iwhalecloud.byai.manager.dto.aimodel.ModelVO;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class AuditLogSanitizerTest {
    @Test
    void hidesModelCredentialsAndHeaderValuesWithoutMutatingTheApiResponse() {
        ModelVO model = new ModelVO();
        model.setProviderName("VOLCENGINE");
        model.setApiToken("fake-provider-secret");
        model.setHeaders(List.of(Map.of("key", "X-Api-Key", "value", "fake-header-secret"),
            Map.of("key", "Content-Type", "value", "application/json")));
        model.setExtendParam("{\"accessKey\":\"fake-options-secret\",\"voice\":\"sample-voice\"}");
        String audit = AuditLogSanitizer.serialize(Map.of("data", model));
        assertThat(audit).doesNotContain("fake-provider-secret", "fake-header-secret", "fake-options-secret")
            .contains("[REDACTED]", "VOLCENGINE", "application/json", "sample-voice");
        assertThat(model.getApiToken()).isEqualTo("fake-provider-secret");
        assertThat(model.getHeaders().get(0).get("value")).isEqualTo("fake-header-secret");
    }

    @Test
    void hidesTokensInNestedMapsAndNamedHeadersButKeepsUsefulFields() {
        String audit = AuditLogSanitizer.serialize(Map.of("nested", Map.of("Beyond-Token", "fake-session-secret",
            "Authorization", "fake-auth-secret", "modelCode", "bigmodel"),
            "headers", List.of(Map.of("name", "Authorization", "value", "fake-list-secret"))));
        assertThat(audit).doesNotContain("fake-session-secret", "fake-auth-secret", "fake-list-secret")
            .contains("bigmodel", "[REDACTED]");
    }
}
