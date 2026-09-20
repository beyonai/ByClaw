package com.iwhalecloud.byai.state.domain.groupchat;

import java.util.Collection;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.groupchat.GroupWorkAssistantMapper;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupWorkAssistantService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupWorkAssistantResponse;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class GroupWorkAssistantServiceTest {
    private final ByaiSystemConfigService config = mock(ByaiSystemConfigService.class);
    private final GroupWorkAssistantMapper mapper = mock(GroupWorkAssistantMapper.class);
    private final SsResourceService resources = mock(SsResourceService.class);
    private final GroupWorkAssistantService service = new GroupWorkAssistantService(config, mapper, resources);

    @BeforeEach
    void setUp() {
        when(resources.findByIdList(any())).thenAnswer(invocation -> {
            Collection<Long> ids = invocation.getArgument(0);
            return ids.stream().sorted(java.util.Comparator.reverseOrder()).map(id -> {
                SsResource resource = new SsResource();
                resource.setResourceId(id);
                resource.setResourceName("Employee " + id);
                resource.setResourceDesc("Description " + id);
                resource.setAvatar("avatar-" + id);
                resource.setResourceStatus(2);
                return resource;
            }).toList();
        });
    }

    @Test
    void usesDefaultNameWithoutConfiguration() {
        when(mapper.findCandidates("群组工作助手")).thenReturn(List.of(30L));
        assertThat(service.getDefaultAssistants()).extracting(GroupWorkAssistantResponse::resourceId)
            .containsExactly("30");
    }

    @Test
    void blankConfigurationUsesDefaultName() {
        when(config.getDcSystemConfigValueByCode(GroupWorkAssistantService.NAME_CONFIG)).thenReturn("  ");
        when(mapper.findCandidates("群组工作助手")).thenReturn(List.of(30L));
        assertThat(service.getDefaultAssistants()).hasSize(1);
    }

    @Test
    void acceptsMultipleNamesAndAllMatchesInConfigurationOrderWithoutDuplicates() {
        when(config.getDcSystemConfigValueByCode(GroupWorkAssistantService.NAME_CONFIG))
            .thenReturn("[\"Knowledge Assistant\",\"群组工作助手\",\"Knowledge Assistant\"]");
        when(mapper.findCandidates("Knowledge Assistant")).thenReturn(List.of(40L));
        when(mapper.findCandidates("群组工作助手")).thenReturn(List.of(30L, 31L, 40L));
        assertThat(service.getDefaultAssistants()).containsExactly(
            new GroupWorkAssistantResponse("40", "Employee 40", "Description 40", "avatar-40"),
            new GroupWorkAssistantResponse("30", "Employee 30", "Description 30", "avatar-30"),
            new GroupWorkAssistantResponse("31", "Employee 31", "Description 31", "avatar-31"));
        verify(mapper, times(1)).findCandidates("Knowledge Assistant");
    }

    @Test
    void supportsLegacyLocalizedName() {
        when(config.getDcSystemConfigValueByCode(GroupWorkAssistantService.NAME_CONFIG))
            .thenReturn(" Group Work Assistant ");
        when(mapper.findCandidates("Group Work Assistant")).thenReturn(List.of(31L));
        assertThat(service.getDefaultAssistants()).extracting(GroupWorkAssistantResponse::resourceId)
            .containsExactly("31");
        verify(mapper, never()).findCandidates("群组工作助手");
    }

    @Test
    void returnsEmptyListWhenNoMatchesOrExplicitEmptyConfiguration() {
        assertThat(service.getDefaultAssistants()).isEmpty();
        when(config.getDcSystemConfigValueByCode(GroupWorkAssistantService.NAME_CONFIG)).thenReturn("[]");
        assertThat(service.getDefaultAssistants()).isEmpty();
        verifyNoInteractions(resources);
    }
}
