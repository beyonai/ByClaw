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
    void publicationSummaryValidatesProvenanceAndKeepsFirstRankedSnapshot() {
        SsResExtSkillMapper mapper = mock(SsResExtSkillMapper.class);
        ReflectionTestUtils.setField(service, "ssResExtSkillMapper", mapper);
        assertThat(service.findCurrentPublications(null)).isEmpty();
        assertThat(service.findCurrentPublications(List.of())).isEmpty();
        verifyNoInteractions(mapper);
        var active = publicationCopy(701L, 4, "{\"sourceResourceId\":601}");
        var rejected = publicationCopy(702L, 5, "{\"sourceResourceId\":601}");
        var deleted = publicationCopy(703L, -1, "{\"sourceResourceId\":602}");
        when(mapper.findPublicationCopies(List.of(601L, 602L))).thenReturn(List.of(
            publicationCopy(700L, 2, "invalid"), publicationCopy(704L, 2, "{\"sourceResourceId\":999}"),
            active, rejected, deleted));
        var result = service.findCurrentPublications(List.of(601L, 602L));
        assertThat(result).containsOnlyKeys(601L, 602L);
        assertThat(result.get(601L).getResourceId()).isEqualTo(701L);
        assertThat(result.get(601L).getResourceStatus()).isEqualTo(4);
        assertThat(result.get(602L).getResourceStatus()).isEqualTo(-1);
        verify(mapper).findPublicationCopies(List.of(601L, 602L));
    }

    private com.iwhalecloud.byai.manager.dto.resource.SsResExtSkillDto publicationCopy(
        Long id, int status, String provenance) {
        var copy = new com.iwhalecloud.byai.manager.dto.resource.SsResExtSkillDto();
        copy.setResourceId(id); copy.setResourceName("企业技能"); copy.setResourceStatus(status);
        var ext = new SsResExtSkill(); ext.setTargetContent(provenance); copy.setSsResExtSkill(ext);
        return copy;
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
