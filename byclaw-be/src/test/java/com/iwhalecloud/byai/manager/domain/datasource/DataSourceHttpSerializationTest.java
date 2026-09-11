package com.iwhalecloud.byai.manager.domain.datasource;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.alibaba.fastjson.support.spring.FastJsonHttpMessageConverter;
import com.iwhalecloud.byai.manager.dto.datasource.DataSourceSaveDto;
import com.iwhalecloud.byai.manager.dto.datasource.DataSourceView;
import com.iwhalecloud.byai.manager.dto.datasource.SessionResourcePage;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.infrastructure.filter.WebMvcConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.mock.http.MockHttpInputMessage;
import org.springframework.mock.http.MockHttpOutputMessage;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import static org.assertj.core.api.Assertions.assertThat;

class DataSourceHttpSerializationTest {
    private FastJsonHttpMessageConverter converter() {
        List<HttpMessageConverter<?>> converters = new ArrayList<>();
        new WebMvcConfiguration().extendMessageConverters(converters);
        return (FastJsonHttpMessageConverter) converters.getFirst();
    }

    @Test
    void actualHttpConverterWritesRecordFieldsAndPermissionFlags() throws Exception {
        DataSourceView view = new DataSourceView("9007199254740993", "报表库", "说明", "opengauss",
            Map.of("host", "localhost", "port", 5432), true, false, true);
        MockHttpOutputMessage output = new MockHttpOutputMessage();
        converter().write(ResponseUtil.successResponse(view), MediaType.APPLICATION_JSON, output);
        JSONObject response = JSON.parseObject(output.getBodyAsString(StandardCharsets.UTF_8));
        assertThat(response.getIntValue("code")).isZero();
        JSONObject data = response.getJSONObject("data");
        assertThat(data).containsEntry("datasourceId", "9007199254740993")
            .containsEntry("datasourceName", "报表库").containsEntry("datasourceType", "opengauss")
            .containsEntry("hasPassword", true).containsEntry("canEdit", false)
            .containsEntry("canManageBinding", true);
        assertThat(data.getJSONObject("connectionConfig")).containsEntry("host", "localhost");
        assertThat(data.getJSONObject("connectionConfig").getIntValue("port")).isEqualTo(5432);
        assertThat(data).doesNotContainKeys("password", "passwordCipher", "credentials", "dataSourceId", "name", "type", "config");
    }

    @Test
    void actualHttpConverterWritesResourcePageIncludingEmptyItems() throws Exception {
        for (List<Map<String, Object>> items : List.of(
                List.<Map<String, Object>>of(Map.of("resourceType", "data_source", "resourceId", "99")),
                List.<Map<String, Object>>of())) {
            MockHttpOutputMessage output = new MockHttpOutputMessage();
            converter().write(ResponseUtil.successResponse(new SessionResourcePage(items, 5L, 3, 2)),
                MediaType.APPLICATION_JSON, output);
            JSONObject page = JSON.parseObject(output.getBodyAsString(StandardCharsets.UTF_8)).getJSONObject("data");
            assertThat(page.getLongValue("total")).isEqualTo(5);
            assertThat(page.getIntValue("pageNum")).isEqualTo(3);
            assertThat(page.getIntValue("pageSize")).isEqualTo(2);
            assertThat(page.getJSONArray("items")).hasSize(items.size());
        }
    }

    @Test
    void queryAndBindingRequestsUseConsistentDatasourceFields() throws Exception {
        String body = "{\"sessionId\":\"10\",\"resourceType\":\"data_source\",\"datasourceType\":\"opengauss\"}";
        MockHttpInputMessage input = new MockHttpInputMessage(body.getBytes(StandardCharsets.UTF_8));
        var query = (com.iwhalecloud.byai.manager.dto.datasource.SessionResourceQueryDto)
            converter().read(com.iwhalecloud.byai.manager.dto.datasource.SessionResourceQueryDto.class, input);
        assertThat(query.getDatasourceType()).isEqualTo("opengauss");
        input = new MockHttpInputMessage("{\"projectId\":\"10\",\"datasourceId\":\"17\"}".getBytes(StandardCharsets.UTF_8));
        var binding = (com.iwhalecloud.byai.manager.dto.datasource.DataSourceScopeDto)
            converter().read(com.iwhalecloud.byai.manager.dto.datasource.DataSourceScopeDto.class, input);
        assertThat(binding.getDatasourceId()).isEqualTo(17L);
    }

    @Test
    void writeOnlyPasswordStillBindsThroughActualRequestConverter() throws Exception {
        String body = """
            {"projectId":"10","datasourceId":"17","datasourceName":"报表库","datasourceType":"opengauss",
             "connectionConfig":{"host":"localhost","database":"report","username":"reader"},
             "password":"test-only-secret"}
            """;
        MockHttpInputMessage input = new MockHttpInputMessage(body.getBytes(StandardCharsets.UTF_8));
        input.getHeaders().setContentType(MediaType.APPLICATION_JSON);
        DataSourceSaveDto request = (DataSourceSaveDto) converter().read(DataSourceSaveDto.class, input);
        assertThat(request.getProjectId()).isEqualTo(10L);
        assertThat(request.getDatasourceId()).isEqualTo(17L);
        assertThat(request.getDatasourceName()).isEqualTo("报表库");
        assertThat(request.getDatasourceType()).isEqualTo("opengauss");
        assertThat(request.getConnectionConfig()).containsEntry("database", "report");
        assertThat(request.getPassword()).isEqualTo("test-only-secret");
        MockHttpOutputMessage output = new MockHttpOutputMessage();
        converter().write(request, MediaType.APPLICATION_JSON, output);
        assertThat(output.getBodyAsString(StandardCharsets.UTF_8)).doesNotContain("test-only-secret", "password");
    }
}
