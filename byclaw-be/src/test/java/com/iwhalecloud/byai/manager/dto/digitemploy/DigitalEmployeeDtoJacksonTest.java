package com.iwhalecloud.byai.manager.dto.digitemploy;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class DigitalEmployeeDtoJacksonTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void skills_acceptsJsonArrayAndStoresAsJsonString() throws Exception {
        String json = """
            {
              "resourceName": "zs001",
              "skills": ["1password", "apple-notes"]
            }
            """;

        DigitalEmployeeDTO dto = objectMapper.readValue(json, DigitalEmployeeDTO.class);

        assertThat(dto.getSkills()).isEqualTo("[\"1password\",\"apple-notes\"]");
    }

    @Test
    void skills_keepsPlainStringPayloadUnchanged() throws Exception {
        String json = """
            {
              "resourceName": "zs001",
              "skills": "[\\"1password\\",\\"apple-notes\\"]"
            }
            """;

        DigitalEmployeeDTO dto = objectMapper.readValue(json, DigitalEmployeeDTO.class);

        assertThat(dto.getSkills()).isEqualTo("[\"1password\",\"apple-notes\"]");
    }
}
