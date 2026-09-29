package com.iwhalecloud.byai.manager.domain.resource.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtSkillMapper;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtSkill;
import org.springframework.test.util.ReflectionTestUtils;
import java.util.List;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class SsResExtSkillServiceTest {

    private final SsResExtSkillService service = new SsResExtSkillService();

    @Test
    void enterpriseCopyLookupValidatesSourceAndDeduplicatesWithoutQueryingEmptyInput() {
        SsResExtSkillMapper mapper = mock(SsResExtSkillMapper.class);
        ReflectionTestUtils.setField(service, "ssResExtSkillMapper", mapper);
        assertThat(service.findSourceIdsWithEnterpriseCopies(List.of())).isEmpty();
        assertThat(service.findSourceIdsWithEnterpriseCopies(null)).isEmpty();
        verifyNoInteractions(mapper);
        List<SsResExtSkill> copies = java.util.stream.Stream.of(
            "{\"sourceResourceId\":\"601\"}", "{\"sourceResourceId\":601}",
            "{\"sourceResourceId\":602}", "{\"sourceResourceId\":\"invalid\"}", "{}", "invalid", "null")
            .map(content -> {
                SsResExtSkill copy = new SsResExtSkill();
                copy.setTargetContent(content);
                return copy;
            }).toList();
        when(mapper.findExistingEnterpriseCopies(List.of(601L))).thenReturn(copies);
        assertThat(service.findSourceIdsWithEnterpriseCopies(List.of(601L))).containsExactly(601L);
        verify(mapper).findExistingEnterpriseCopies(List.of(601L));
    }

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
