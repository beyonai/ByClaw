package com.iwhalecloud.byai.manager.domain.resource.util;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class DigEmployeeRedisKeysTest {

    @Test
    void configJsonKey_matchesOpenResourceFileBaseName() {
        assertThat(DigEmployeeRedisKeys.configJsonKey(10000005L)).isEqualTo("DIG_EMPLOYEE_10000005");
    }

    @Test
    void skillCacheKey_usesResourcePrefix() {
        assertThat(DigEmployeeRedisKeys.skillCacheKey(42L)).isEqualTo("RESOURCE_DIG_EMPLOYEE_42");
    }

    @Test
    void resourceConfigJsonKey_matchesOpenResourceFileBaseName() {
        assertThat(DigEmployeeRedisKeys.resourceConfigJsonKey("AGENT", 1111L)).isEqualTo("AGENT_1111");
        assertThat(DigEmployeeRedisKeys.resourceConfigJsonKey("KG_DOC", 10000001L)).isEqualTo("KG_DOC_10000001");
        assertThat(DigEmployeeRedisKeys.resourceConfigJsonKey("toolkit", 50L)).isEqualTo("TOOLKIT_50");
    }
}
