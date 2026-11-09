package com.iwhalecloud.byai.state.domain.resource.service;

import static org.assertj.core.api.Assertions.*;

import com.iwhalecloud.byai.common.lock.DisposableRedis;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.data.redis.connection.RedisClusterConfiguration;
import org.springframework.data.redis.connection.jedis.JedisConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.util.ReflectionTestUtils;

/** Real Redis reads, including mixed hash slots; never connects to an application Redis. */
class RedisResourceRetirementIntegrationTest {
    @Test
    void standaloneFiltersLegacySnapshotsAndPreservesMixedBatchResults() throws Exception {
        try (var fixture = new DisposableRedis()) { verifyContract(new StringRedisTemplate(fixture.connection)); }
    }

    @Test
    @EnabledIfEnvironmentVariable(named = "BYCLAW_TEST_REDIS_CLUSTER_PORT", matches = "[0-9]+")
    void clusterFiltersLegacySnapshotsAcrossDifferentSlots() {
        var factory = new JedisConnectionFactory(new RedisClusterConfiguration(List.of(
            "127.0.0.1:" + System.getenv("BYCLAW_TEST_REDIS_CLUSTER_PORT"))));
        factory.afterPropertiesSet(); factory.start();
        try { verifyContract(new StringRedisTemplate(factory)); }
        finally { factory.destroy(); }
    }

    @SuppressWarnings("unchecked")
    private void verifyContract(StringRedisTemplate redis) {
        var login = new LoginInfo(); login.setUserCode("retirement-test");
        CurrentUserHolder.setLoginInfo(login);
        String userKey = "SHARE_BFM_USER_CODE_retirement-test";
        String authKey = "USER:RESOURCES:AUTH:267";
        List<String> keys = List.of(userKey, authKey, "DIG_EMPLOYEE_1", "KG_DOC_2", "KG_DOC_3", "OBJECT_11");
        try {
            redis.opsForValue().set(userKey, "267");
            redis.opsForHash().putAll(authKey, Map.of("1", "DIG_EMPLOYEE", "2", "KG_DOC", "3", "KG_DOC",
                "11", "OBJECT", "12", "view", "13", "{\"resourceBizType\":\"ONTOLOGY_BASE\"}", "14", "SCENE"));
            redis.opsForValue().set("DIG_EMPLOYEE_1", "{\"resourceId\":\"1\",\"relIds\":[11,2],\"relResourceList\":[{\"resourceId\":11,\"resourceBizType\":\"OBJECT\"},{\"resourceId\":2,\"resourceBizType\":\"KG_DOC\"}]}");
            redis.opsForValue().set("KG_DOC_2", "{\"resourceId\":2,\"resourceBizType\":\"KG_DOC\",\"resourceName\":\"kept\"}");
            redis.opsForValue().set("KG_DOC_3", "{\"resourceId\":3,\"resourceBizType\":\"VIEW\",\"resourceName\":\"hidden\"}");
            redis.opsForValue().set("OBJECT_11", "{\"resourceName\":\"historical\"}");
            var service = new RedisResourceQueryService(); ReflectionTestUtils.setField(service, "redis", redis);
            var authorized = (List<Map<String, String>>) service.query(Map.of("queryType", "AUTHORIZED_RESOURCE_IDS")).get("resources");
            assertThat(authorized).extracting(item -> item.get("resourceId")).containsExactlyInAnyOrder("1", "2", "3");
            for (String id : List.of("11", "12", "13", "14", "3")) {
                assertThat(service.query(Map.of("resourceId", id))).containsEntry("allowed", false).containsEntry("reason", "RESOURCE_TYPE_RETIRED");
            }
            assertThat(service.query(Map.of("resourceId", "99"))).containsEntry("allowed", false).doesNotContainKey("reason");
            var result = service.query(Map.of("queryType", "BATCH_BY_RESOURCE_IDS", "resourceIds", List.of("1", "2", "11", "12", "13", "14", "3", "99")));
            var items = (List<Map<String, Object>>) result.get("items");
            assertThat(items).hasSize(8);
            assertThat(items.subList(0, 2)).allSatisfy(item -> assertThat(item).containsEntry("allowed", true));
            assertThat(items.subList(2, 8)).allSatisfy(item -> assertThat(item).containsEntry("allowed", false));
            assertThat(items.get(0).get("data").toString()).doesNotContain("OBJECT");
            assertThat(redis.opsForValue().get("OBJECT_11")).contains("historical");
        } finally {
            // Per-key delete is Cluster-safe and leaves unrelated local test data intact.
            keys.forEach(redis::delete); CurrentUserHolder.setLoginInfo(null);
        }
    }
}
