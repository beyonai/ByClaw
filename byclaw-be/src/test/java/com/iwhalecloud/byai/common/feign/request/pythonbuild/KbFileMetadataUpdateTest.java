package com.iwhalecloud.byai.common.feign.request.pythonbuild;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class KbFileMetadataUpdateTest {

    private final ObjectMapper mapper = new ObjectMapper();

    @ParameterizedTest
    @ValueSource(strings = {"append", "remove"})
    void listOperationsOmitValueType(String operation) throws Exception {
        JsonNode json = serialize(operation, null, List.of("beta"));

        assertThat(json.has("valueType")).isFalse();
        assertThat(json.get("value")).isEqualTo(mapper.valueToTree(List.of("beta")));
    }

    @ParameterizedTest
    @ValueSource(strings = {"unset", "clear"})
    void valuelessOperationsOmitValueAndValueType(String operation) throws Exception {
        JsonNode json = serialize(operation, null, null);

        assertThat(json.has("valueType")).isFalse();
        assertThat(json.has("value")).isFalse();
    }

    @Test
    void setPreservesTypeAndFalseValue() throws Exception {
        JsonNode json = serialize("set", "boolean", false);

        assertThat(json.get("valueType").asText()).isEqualTo("boolean");
        assertThat(json.get("value").isBoolean()).isTrue();
        assertThat(json.get("value").booleanValue()).isFalse();
    }

    @Test
    void setPreservesEmptyList() throws Exception {
        JsonNode json = serialize("set", "stringList", List.of());

        assertThat(json.get("valueType").asText()).isEqualTo("stringList");
        assertThat(json.get("value")).isEqualTo(mapper.valueToTree(List.of()));
    }

    private JsonNode serialize(String operation, String valueType, Object value) throws Exception {
        KbFileMetadataUpdate.MetadataOperation item = new KbFileMetadataUpdate.MetadataOperation();
        item.setPropertyName("test_tags");
        item.setOperation(operation);
        item.setValueType(valueType);
        item.setValue(value);
        KbFileMetadataUpdate request = new KbFileMetadataUpdate();
        request.setKnCode("example");
        request.setFilePath("/CLAUDE.md");
        request.setOperationList(List.of(item));

        JsonNode json = mapper.readTree(mapper.writeValueAsString(request));
        assertThat(json.get("knCode").asText()).isEqualTo("example");
        assertThat(json.get("filePath").asText()).isEqualTo("/CLAUDE.md");
        JsonNode serialized = json.get("operationList").get(0);
        assertThat(serialized.get("propertyName").asText()).isEqualTo("test_tags");
        assertThat(serialized.get("operation").asText()).isEqualTo(operation);
        return serialized;
    }
}
