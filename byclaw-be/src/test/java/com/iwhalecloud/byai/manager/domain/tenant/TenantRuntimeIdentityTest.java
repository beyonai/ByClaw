package com.iwhalecloud.byai.manager.domain.tenant;

import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;

class TenantRuntimeIdentityTest {
    @Test void stableAcrossRestartsButSeparatedByPurposeAndDeployment() {
        var first = new TenantRuntimeIdentity("deployment-one-secret-with-at-least-32-bytes");
        var restarted = new TenantRuntimeIdentity("deployment-one-secret-with-at-least-32-bytes");
        var other = new TenantRuntimeIdentity("deployment-two-secret-with-at-least-32-bytes");
        assertThat(first.masterKeyHex()).matches("[a-f0-9]{64}").isEqualTo(restarted.masterKeyHex());
        assertThat(first.internalToken()).hasSize(43).isEqualTo(restarted.internalToken());
        assertThat(first.masterKeyHex()).isNotEqualTo(other.masterKeyHex()).isNotEqualTo(first.internalToken());
        assertThat(first.internalToken()).isNotEqualTo(other.internalToken());
    }
    @Test void databaseIdentityIsReadOnceAndMustBeUnambiguous() {
        var mapper = org.mockito.Mockito.mock(com.iwhalecloud.byai.manager.mapper.source.SourceSystemMapper.class);
        org.mockito.Mockito.when(mapper.selectPlatformIdentitySecrets())
            .thenReturn(java.util.List.of("deployment-one-secret-with-at-least-32-bytes"));
        var identity = new TenantRuntimeIdentity(mapper);
        assertThat(identity.masterKeyHex()).hasSize(64);
        assertThat(identity.internalToken()).hasSize(43);
        org.mockito.Mockito.verify(mapper, org.mockito.Mockito.times(1)).selectPlatformIdentitySecrets();
        org.mockito.Mockito.when(mapper.selectPlatformIdentitySecrets()).thenReturn(java.util.List.of());
        assertThatThrownBy(() -> new TenantRuntimeIdentity(mapper).internalToken()).isInstanceOf(IllegalStateException.class);
    }
    @Test void missingDeploymentIdentityCannotSilentlyUseASharedDefault() {
        assertThatThrownBy(() -> new TenantRuntimeIdentity("").masterKeyHex()).isInstanceOf(IllegalStateException.class);
    }
}
