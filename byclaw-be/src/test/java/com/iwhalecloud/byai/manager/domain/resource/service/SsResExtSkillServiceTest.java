package com.iwhalecloud.byai.manager.domain.resource.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class SsResExtSkillServiceTest {

    private final SsResExtSkillService service = new SsResExtSkillService();

    @Test
    void nextVersion_incrementsMinorVersion() {
        assertThat(service.nextVersion("v0.1")).isEqualTo("v0.2");
        assertThat(service.nextVersion("v1.9")).isEqualTo("v1.10");
    }

    @Test
    void nextVersion_returnsDefaultVersionWhenCurrentVersionInvalid() {
        assertThat(service.nextVersion(null)).isEqualTo(SsResExtSkillService.DEFAULT_VERSION);
        assertThat(service.nextVersion("")).isEqualTo(SsResExtSkillService.DEFAULT_VERSION);
        assertThat(service.nextVersion("1.0")).isEqualTo(SsResExtSkillService.DEFAULT_VERSION);
    }
}
