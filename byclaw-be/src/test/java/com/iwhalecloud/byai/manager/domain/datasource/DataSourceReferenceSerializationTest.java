package com.iwhalecloud.byai.manager.domain.datasource;

import com.alibaba.fastjson.JSON;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class DataSourceReferenceSerializationTest {
    @Test
    void conversationReferenceSurvivesRequestAndPersistenceSerializers() throws Exception {
        String incoming = """
            {"id":"DATA_SOURCE_9007199254740993","resourceId":"9007199254740993",
             "resourceName":"报表库","resourceType":"DATA_SOURCE",
             "extData":"{\\\"type\\\":\\\"opengauss\\\"}"}
            """;
        ObjectMapper jackson = new ObjectMapper();
        ResourceVo request = jackson.readValue(incoming, ResourceVo.class);
        assertThat(request.getResourceType()).isEqualTo(AgentMetaEnum.DATA_SOURCE);
        ResourceVo restored = JSON.parseObject(JSON.toJSONString(request), ResourceVo.class);
        assertThat(restored).isEqualTo(request);
        assertThat(jackson.readValue(jackson.writeValueAsString(restored), ResourceVo.class)).isEqualTo(request);
        assertThat(restored.getResourceId()).isEqualTo("9007199254740993");
        assertThat(JSON.parseObject(restored.getExtData()).getString("type")).isEqualTo("opengauss");
        assertThat(JSON.toJSONString(restored)).doesNotContain("password", "config", "credentials");
    }
}
