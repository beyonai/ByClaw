package com.iwhalecloud.byai.state.domain.resource.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.data.redis.core.HashOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.constants.staticdata.RedisConfig;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;

/**
 * 入口 3 {@code /api/v1/resources/query} 的停用类型判定单测。
 *
 * <p>覆盖 AC-007 / AC-015：三种授权查询路径不返回停用类型；{@code BY_RESOURCE_ID} 与
 * {@code BATCH_BY_RESOURCE_IDS} 的停用条目都带 {@code RESOURCE_TYPE_DISABLED} 原因码，
 * 且裸前缀与 JSON 两种存储形态得到同一结果；模型查询与既有"未授权/不支持类型"响应形状逐字段不变。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class RedisResourceQueryServiceTest {

    private static final String AUTH_KEY = "USER:RESOURCES:AUTH:7";
    private static final String USER_CODE = "u-100";

    @Mock
    private StringRedisTemplate redis;

    @Mock
    private HashOperations<String, Object, Object> hashOperations;

    @Mock
    private ValueOperations<String, String> valueOperations;

    private RedisResourceQueryService service;

    @BeforeEach
    void setUp() {
        service = new RedisResourceQueryService();
        ReflectionTestUtils.setField(service, "redis", redis);
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserCode(USER_CODE);
        CurrentUserHolder.setLoginInfo(loginInfo);
        when(redis.opsForValue()).thenReturn(valueOperations);
        when(valueOperations.get("SHARE_BFM_USER_CODE_" + USER_CODE)).thenReturn("7");
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.setLoginInfo(null);
    }

    @Test
    void authorizedResourceIdsExcludesDisabledTypesAndKeepsNormalOnes() {
        when(redis.opsForHash()).thenReturn(hashOperations);
        Map<Object, Object> entries = new LinkedHashMap<>();
        entries.put("100", "OBJECT");
        entries.put("101", "KG_DOC");
        entries.put("102", "{\"resourceType\":\"VIEW\"}");
        entries.put("103", "DIG_EMPLOYEE");
        entries.put("104", "view");
        when(hashOperations.entries(AUTH_KEY)).thenReturn(entries);

        Map<String, Object> response = service.query(Map.of("queryType", "AUTHORIZED_RESOURCE_IDS"));

        assertThat(response).containsEntry("queryType", "AUTHORIZED_RESOURCE_IDS")
            .containsEntry("userId", "7");
        @SuppressWarnings("unchecked")
        List<Map<String, String>> resources = (List<Map<String, String>>) response.get("resources");
        assertThat(resources).extracting(item -> item.get("resourceId"))
            .containsExactly("101", "103");
        assertThat(resources).extracting(item -> item.get("resourceType"))
            .containsExactly("KG_DOC", "DIG_EMPLOYEE");
    }

    @Test
    void byResourceIdRejectsDisabledTypeWithDisabledReason() {
        when(redis.opsForHash()).thenReturn(hashOperations);
        when(hashOperations.get(AUTH_KEY, "200")).thenReturn("OBJECT");

        Map<String, Object> response = service.query(Map.of("queryType", "BY_RESOURCE_ID", "resourceId", "200"));

        assertThat(response).containsEntry("allowed", false)
            .containsEntry("resourceId", "200")
            .containsEntry("reason", "RESOURCE_TYPE_DISABLED");
        assertThat(response).doesNotContainKey("data");
    }

    @Test
    void reasonIsUniformAcrossBarePrefixAndJsonForms() {
        when(redis.opsForHash()).thenReturn(hashOperations);
        Map<String, String> stored = Map.of(
            "1", "OBJECT",
            "2", "{\"resourceType\":\"object\"}",
            "3", "VIEW",
            "4", "{\"resourceBizType\":\"View\"}",
            "5", "SCENE",
            "6", "ONTOLOGY_BASE",
            "7", "{\"resourceType\":\"ontology_base\"}",
            "8", " OBJECT "
        );
        for (Map.Entry<String, String> entry : stored.entrySet()) {
            when(hashOperations.get(AUTH_KEY, entry.getKey())).thenReturn(entry.getValue());
        }

        for (String id : stored.keySet()) {
            Map<String, Object> response = service.query(Map.of("queryType", "BY_RESOURCE_ID", "resourceId", id));
            assertThat(response).as("id=%s", id)
                .containsEntry("allowed", false)
                .containsEntry("reason", "RESOURCE_TYPE_DISABLED");
        }
    }

    @Test
    void unauthorizedAndUnsupportedEntriesKeepExistingShape() {
        when(redis.opsForHash()).thenReturn(hashOperations);
        when(hashOperations.get(AUTH_KEY, "300")).thenReturn(null);
        when(hashOperations.get(AUTH_KEY, "301")).thenReturn("SKILL");

        Map<String, Object> unauthorized = service.query(
            Map.of("queryType", "BY_RESOURCE_ID", "resourceId", "300"));
        assertThat(unauthorized).containsEntry("allowed", false).doesNotContainKey("reason");

        Map<String, Object> unsupported = service.query(
            Map.of("queryType", "BY_RESOURCE_ID", "resourceId", "301"));
        assertThat(unsupported).containsEntry("allowed", false)
            .containsEntry("reason", "UNSUPPORTED_RESOURCE_TYPE");
    }

    @Test
    void batchByResourceIdsMarksEachDisabledEntryWithDisabledReason() {
        when(redis.opsForHash()).thenReturn(hashOperations);
        Map<Object, Object> authorized = new LinkedHashMap<>();
        authorized.put("200", "OBJECT");
        authorized.put("201", "KG_DOC");
        when(hashOperations.entries(AUTH_KEY)).thenReturn(authorized);
        when(valueOperations.multiGet(anyCollection())).thenReturn(new ArrayList<>(List.of("{\"k\":1}")));

        Map<String, Object> response = service.query(
            Map.of("queryType", "BATCH_BY_RESOURCE_IDS", "resourceIds", List.of("200", "201")));

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> items = (List<Map<String, Object>>) response.get("items");
        assertThat(items).hasSize(2);
        assertThat(items.get(0)).containsEntry("resourceId", "200")
            .containsEntry("allowed", false)
            .containsEntry("reason", "RESOURCE_TYPE_DISABLED");
        assertThat(items.get(1)).containsEntry("resourceId", "201")
            .containsEntry("resourceType", "KG_DOC")
            .containsEntry("allowed", true);
        assertThat(response).containsEntry("missingResourceIds", List.of());
    }

    @Test
    void batchByResourceIdsKeepsUnsupportedAndMissingShapes() {
        when(redis.opsForHash()).thenReturn(hashOperations);
        Map<Object, Object> authorized = new LinkedHashMap<>();
        authorized.put("400", "SKILL");
        authorized.put("401", "KG_DOC");
        when(hashOperations.entries(AUTH_KEY)).thenReturn(authorized);
        List<String> nullValue = new ArrayList<>();
        nullValue.add(null);
        when(valueOperations.multiGet(anyCollection())).thenReturn(nullValue);

        Map<String, Object> response = service.query(
            Map.of("queryType", "BATCH_BY_RESOURCE_IDS", "resourceIds", List.of("400", "401")));

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> items = (List<Map<String, Object>>) response.get("items");
        assertThat(items.get(0)).containsEntry("allowed", false).doesNotContainKey("reason");
        assertThat(response).containsEntry("missingResourceIds", List.of("401"));
    }

    @Test
    void batchSizeLimitStillThrows() {
        List<String> ids = new ArrayList<>();
        for (int i = 0; i < 101; i++) {
            ids.add(String.valueOf(i));
        }
        assertThatThrownBy(() -> service.query(Map.of("queryType", "BATCH_BY_RESOURCE_IDS", "resourceIds", ids)))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("max batch size");
    }

    @Test
    void byModelIdAndBatchByModelIdsAreUnchanged() {
        when(redis.opsForHash()).thenReturn(hashOperations);
        when(hashOperations.get(eq(RedisConfig.AI_MODEL_KEY), eq("m1")))
            .thenReturn("{\"status\":\"1\",\"modelType\":\"LLM\"}");

        Map<String, Object> byModel = service.query(Map.of("queryType", "BY_MODEL_ID", "modelId", "m1"));
        assertThat(byModel).containsEntry("modelId", "m1").containsEntry("allowed", true);
        assertThat(byModel.get("data")).isNotNull();

        when(hashOperations.multiGet(eq(RedisConfig.AI_MODEL_KEY), any()))
            .thenReturn(new ArrayList<>(List.of("{\"status\":\"1\",\"modelType\":\"LLM\"}")));
        Map<String, Object> batch = service.query(
            Map.of("queryType", "BATCH_BY_MODEL_IDS", "modelIds", List.of("m1")));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> items = (List<Map<String, Object>>) batch.get("items");
        assertThat(items).hasSize(1);
        assertThat(items.get(0)).containsEntry("modelId", "m1").containsEntry("allowed", true);
    }
}
