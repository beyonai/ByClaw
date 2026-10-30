package com.iwhalecloud.byai.manager.domain.tenant;

import com.iwhalecloud.byai.gateway.sandbox.mapper.*;
import com.iwhalecloud.byai.gateway.sandbox.persistence.*;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class TenantSandboxPropertiesTest {
    @Test void readsEachEnabledServiceDefaultAndObservesLaterTableChanges() {
        var specs=mock(SandboxServiceSpecEntityMapper.class);
        var profiles=mock(SandboxServiceProfileEntityMapper.class);
        var database=service("tenant-opengauss","m");
        var node=service("tenant-data-node","s");
        when(specs.selectProfileAwareByServiceKey("tenant-opengauss")).thenReturn(database);
        when(specs.selectProfileAwareByServiceKey("tenant-data-node")).thenReturn(node);
        when(profiles.selectEnabledProfile(anyString(),anyString())).thenReturn(new SandboxServiceProfileEntity());
        var defaults=new TenantSandboxProperties(specs,profiles);
        assertThat(defaults.getProfileKey()).isEqualTo("m");
        assertThat(defaults.getNodeProfileKey()).isEqualTo("s");
        database.setDefaultProfileKey("l");
        assertThat(defaults.getProfileKey()).isEqualTo("l");
        verify(profiles).selectEnabledProfile("tenant-data-node","s");
    }
    @Test void missingDisabledOrInvalidDefaultDoesNotSilentlyPickAnEnvironmentFallback() {
        var specs=mock(SandboxServiceSpecEntityMapper.class);
        var profiles=mock(SandboxServiceProfileEntityMapper.class);
        var defaults=new TenantSandboxProperties(specs,profiles);
        assertThatThrownBy(defaults::getProfileKey).isInstanceOf(org.springframework.web.server.ResponseStatusException.class)
            .hasMessageContaining("tenant.database.profile.unavailable");
        var database=service("tenant-opengauss","m");
        when(specs.selectProfileAwareByServiceKey("tenant-opengauss")).thenReturn(database);
        assertThatThrownBy(defaults::getProfileKey).isInstanceOf(org.springframework.web.server.ResponseStatusException.class)
            .hasMessageContaining("tenant.database.profile.unavailable");
        when(profiles.selectEnabledProfile(anyString(),anyString())).thenReturn(new SandboxServiceProfileEntity());
        database.setEnabled(0);
        assertThatThrownBy(defaults::getProfileKey).isInstanceOf(org.springframework.web.server.ResponseStatusException.class)
            .hasMessageContaining("tenant.database.profile.unavailable");
    }
    private SandboxServiceSpecEntity service(String key,String profile) {
        var spec=new SandboxServiceSpecEntity();spec.setServiceKey(key);spec.setServiceType(key);
        spec.setOwnerScope("TENANT");spec.setEnabled(1);spec.setDefaultProfileKey(profile);return spec;
    }
}
