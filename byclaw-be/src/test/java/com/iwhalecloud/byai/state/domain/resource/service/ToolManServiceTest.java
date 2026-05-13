package com.iwhalecloud.byai.state.domain.resource.service;

import com.alibaba.fastjson.JSONObject;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;

class ToolManServiceTest {

    @Test
    void resolveAddToolFromThirdCatalogId_usesJsonCatalogId() {
        ToolManService service = new ToolManService();
        JSONObject root = new JSONObject();
        root.put("catalogId", 123L);

        Long catalogId = ReflectionTestUtils.invokeMethod(service, "resolveAddToolFromThirdCatalogId", root);

        assertThat(catalogId).isEqualTo(123L);
    }

    @Test
    void resolveAddToolFromThirdCatalogId_defaultsToZeroWhenJsonCatalogIdMissing() {
        ToolManService service = new ToolManService();
        JSONObject root = new JSONObject();

        Long catalogId = ReflectionTestUtils.invokeMethod(service, "resolveAddToolFromThirdCatalogId", root);

        assertThat(catalogId).isZero();
    }
}
