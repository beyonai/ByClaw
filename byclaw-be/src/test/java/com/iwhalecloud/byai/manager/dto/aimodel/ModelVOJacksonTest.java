package com.iwhalecloud.byai.manager.dto.aimodel;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class ModelVOJacksonTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void id_serializesAsJsonStringWithoutPrecisionLoss() throws Exception {
        ModelVO model = new ModelVO();
        model.setId(9007199254740993L);

        JsonNode id = objectMapper.readTree(objectMapper.writeValueAsString(model)).path("id");

        assertThat(id.isTextual()).isTrue();
        assertThat(id.textValue()).isEqualTo("9007199254740993");
    }
}
