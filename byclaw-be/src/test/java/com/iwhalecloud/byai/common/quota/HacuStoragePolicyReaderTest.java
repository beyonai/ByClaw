package com.iwhalecloud.byai.common.quota;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.support.StaticMessageSource;
import org.springframework.data.redis.core.HashOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** 独立开源部署兼容、HACU 标记、摘要与发布版本一致性。 */
class HacuStoragePolicyReaderTest {
    private final StringRedisTemplate redis = mock(StringRedisTemplate.class);
    private final HashOperations<String, Object, Object> hashes = mock(HashOperations.class);
    private final ObjectMapper json = new ObjectMapper();
    private final SharedQuotaProperties properties = new SharedQuotaProperties();
    private final HacuStoragePolicyReader reader = new HacuStoragePolicyReader(redis, json, properties);
    private Object previousMessages;

    @BeforeEach
    void prepare() {
        previousMessages = ReflectionTestUtils.getField(I18nUtil.class, "messageSource");
        StaticMessageSource messages = new StaticMessageSource(); messages.setUseCodeAsDefaultMessage(true);
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messages);
        when(redis.opsForHash()).thenReturn(hashes);
        when(hashes.get("byclaw:shared:quota:v1:{42}", "revision")).thenReturn("7");
    }

    @AfterEach
    void restoreMessages() {
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", previousMessages);
    }

    @Test
    void noHacuPolicyDoesNotRestrictByclawButManagedMissingPolicyFailsClosed() {
        when(hashes.entries(anyString())).thenReturn(Map.of());
        assertThat(reader.read(42, false)).isNull();
        assertThatThrownBy(() -> reader.read(42, true)).isInstanceOf(ResponseStatusException.class);
    }

    @Test
    void readsFullLongCapacityAndRequiresSamePublishedRevision() throws Exception {
        install(policy().put("storageBytes", "9007199254740993"));
        assertThat(reader.read(42, true)).isEqualTo(9007199254740993L);
        when(hashes.get("byclaw:shared:quota:v1:{42}", "revision")).thenReturn("8");
        assertThatThrownBy(() -> reader.read(42, true)).isInstanceOf(ResponseStatusException.class);
    }

    @Test
    void unrelatedSourceMalformedLimitAndWrongEnterpriseCannotActivatePolicy() throws Exception {
        for (ObjectNode invalid : java.util.List.of(policy().put("source", "OTHER"),
                policy().put("storageBytes", "-1"), policy().put("enterpriseId", "43"),
                policy().put("storageBytes", 1024), policy().put("storageBytes", "9223372036854775808"))) {
            install(invalid);
            assertThatThrownBy(() -> reader.read(42, true)).isInstanceOf(ResponseStatusException.class);
        }
    }

    @Test
    void unlimitedIsExplicitAndRedisOutageDoesNotDisableIndependentByclaw() throws Exception {
        install(policy().put("mode", "UNLIMITED"));
        assertThat(reader.read(42, true)).isNull();
        properties.setFailurePolicy(SharedQuotaProperties.FailurePolicy.REJECT);
        when(hashes.entries(anyString())).thenThrow(new IllegalStateException("offline"));
        assertThat(reader.read(42, false)).isNull();
        assertThatThrownBy(() -> reader.read(42, true)).isInstanceOf(ResponseStatusException.class);
    }

    @Test
    void damagedDigestIsNeverTreatedAsNoPackage() {
        when(hashes.entries(anyString())).thenReturn(Map.of("revision", "7", "payload", "{}", "payloadHash", "0".repeat(64)));
        assertThatThrownBy(() -> reader.read(42, false)).isInstanceOf(ResponseStatusException.class);
    }

    private ObjectNode policy() {
        return json.createObjectNode().put("schemaVersion", 1).put("source", "HACU").put("scope", "HACU_WORKGROUP")
            .put("enterpriseId", "42").put("revision", "7").put("mode", "LIMITED").put("storageBytes", "1024");
    }

    private void install(ObjectNode policy) throws Exception {
        String payload = policy.toString();
        String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(payload.getBytes(StandardCharsets.UTF_8)));
        when(hashes.entries("byclaw:shared:quota:v1:storage:{42}")).thenReturn(
            Map.of("revision", "7", "payload", payload, "payloadHash", hash));
    }
}
