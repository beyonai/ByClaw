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

    @Test
    void relSkills_acceptsLegacyStringArray() throws Exception {
        String json = """
            {
              "resourceName": "zs001",
              "relSkills": ["知识采集（OpenCLI）"]
            }
            """;

        DigitalEmployeeDTO dto = objectMapper.readValue(json, DigitalEmployeeDTO.class);

        assertThat(dto.getRelSkills()).containsExactly("知识采集（OpenCLI）");
    }

    @Test
    void relSkills_acceptsStandardObjectArray() throws Exception {
        String json = """
            {
              "resourceName": "zs001",
              "relSkills": [
                {
                  "resourceId": 10001,
                  "skillCode": "opencli-knowledge",
                  "skillType": "hub",
                  "skillUrl": "/byaiService/tool/downloadSkillZip?skillId=10001",
                  "versionUrl": "/byaiService/tool/getSkillVersion?skillId=10001"
                }
              ]
            }
            """;

        DigitalEmployeeDTO dto = objectMapper.readValue(json, DigitalEmployeeDTO.class);

        assertThat(dto.getRelSkills()).hasSize(1);
    }

    @Test
    void imageModelId_serializesAsStringWithoutPrecisionLoss() throws Exception {
        DigitalEmployeeDTO dto = new DigitalEmployeeDTO();
        dto.setImageModelId("9007199254740993");

        String json = objectMapper.writeValueAsString(dto);

        assertThat(objectMapper.readTree(json).path("imageModelId").asText()).isEqualTo("9007199254740993");
    }
}
