package com.iwhalecloud.byai.manager.domain.datasource;

import com.iwhalecloud.byai.common.exception.BaseException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import java.util.HashMap;
import java.util.Map;
import static org.assertj.core.api.Assertions.*;

class OpenGaussDataSourceProviderTest {
    private final OpenGaussDataSourceProvider provider = new OpenGaussDataSourceProvider();

    @Test
    void normalizesTextAndSuppliesSecureDefaultsWithoutMutatingInput() {
        Map<String, Object> input = config();
        input.put("host", " localhost ");
        assertThat(provider.validate(input)).containsEntry("host", "localhost")
            .containsEntry("port", 5432).containsEntry("sslMode", "require");
        assertThat(input).containsEntry("host", " localhost ").doesNotContainKey("port");
    }

    @ParameterizedTest
    @ValueSource(strings = {"0", "65536", "5432.5", "abc", "9223372036854775807"})
    void rejectsInvalidPorts(String port) {
        Map<String, Object> input = config();
        input.put("port", port);
        assertThatThrownBy(() -> provider.validate(input)).isInstanceOf(BaseException.class);
    }

    @ParameterizedTest
    @ValueSource(strings = {"jdbc:postgresql://localhost/db", "user:secret@localhost", "local host", "localhost;password=x", "localhost\n"})
    void rejectsUrlCredentialsAndMalformedHost(String host) {
        Map<String, Object> input = config();
        input.put("host", host);
        assertThatThrownBy(() -> provider.validate(input)).isInstanceOf(BaseException.class);
    }

    @Test
    void rejectsSecretsUnknownFieldsAndWrongFieldTypes() {
        for (String field : new String[]{"password", "passwordCipher", "jdbcUrl", "options"}) {
            Map<String, Object> input = config();
            input.put(field, "hidden");
            assertThatThrownBy(() -> provider.validate(input)).isInstanceOf(BaseException.class);
        }
        Map<String, Object> input = config();
        input.put("username", 123);
        assertThatThrownBy(() -> provider.validate(input)).isInstanceOf(BaseException.class);
        Map<String, Object> invalidSsl = config();
        invalidSsl.put("sslMode", "prefer");
        assertThatThrownBy(() -> provider.validate(invalidSsl)).isInstanceOf(BaseException.class);
    }

    private Map<String, Object> config() {
        return new HashMap<>(Map.of("host", "localhost", "database", "report", "username", "reader"));
    }
}
