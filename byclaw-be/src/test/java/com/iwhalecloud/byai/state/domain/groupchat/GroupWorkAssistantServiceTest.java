package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import java.util.List;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.mapper.groupchat.GroupWorkAssistantMapper;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupWorkAssistantService;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class GroupWorkAssistantServiceTest {
    private final ByaiSystemConfigService config = mock(ByaiSystemConfigService.class);
    private final GroupWorkAssistantMapper mapper = mock(GroupWorkAssistantMapper.class);
    private final GroupWorkAssistantService service = new GroupWorkAssistantService(config, mapper);

    @BeforeEach
    void login() {
        LoginInfo login = new LoginInfo();
        login.setUserId(10L);
        login.setEnterpriseId(20L);
        CurrentUserHolder.setLoginInfo(login);
    }

    @AfterEach
    void clear() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void usesDefaultNameWithoutConfiguration() {
        when(mapper.findCandidates("群组工作助手")).thenReturn(List.of(30L));
        assertThat(service.resolveResourceId()).isEqualTo(30L);
    }

    @Test
    void blankConfigurationAlsoUsesDefaultName() {
        when(config.getDcSystemConfigValueByCode(GroupWorkAssistantService.NAME_CONFIG)).thenReturn("  ");
        when(mapper.findCandidates("群组工作助手")).thenReturn(List.of(30L));
        assertThat(service.resolveResourceId()).isEqualTo(30L);
    }

    @Test
    void usesConfiguredLocalizedNameWithoutChineseFallback() {
        when(config.getDcSystemConfigValueByCode(GroupWorkAssistantService.NAME_CONFIG)).thenReturn(" Group Work Assistant ");
        when(mapper.findCandidates("Group Work Assistant")).thenReturn(List.of(31L));
        assertThat(service.resolveResourceId()).isEqualTo(31L);
        verify(mapper, never()).findCandidates("群组工作助手");
    }

    @Test
    void skipsMissingOrAmbiguousEmployees() {
        when(mapper.findCandidates("群组工作助手")).thenReturn(List.of(), List.of(30L, 31L));
        assertThat(service.resolveResourceId()).isNull();
        assertThat(service.resolveResourceId()).isNull();
    }

    @Test
    void resolvesSamePlatformAssistantForDifferentEnterprises() {
        when(mapper.findCandidates("群组工作助手")).thenReturn(List.of(30L));
        assertThat(service.resolveResourceId()).isEqualTo(30L);
        LoginInfo otherEnterprise = new LoginInfo();
        otherEnterprise.setUserId(11L);
        otherEnterprise.setEnterpriseId(21L);
        CurrentUserHolder.setLoginInfo(otherEnterprise);
        assertThat(service.resolveResourceId()).isEqualTo(30L);
    }
}
