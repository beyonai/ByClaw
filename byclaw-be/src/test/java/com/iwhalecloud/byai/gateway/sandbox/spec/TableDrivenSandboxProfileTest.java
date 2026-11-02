package com.iwhalecloud.byai.gateway.sandbox.spec;
import com.iwhalecloud.byai.gateway.sandbox.config.SandboxProperties;
import com.iwhalecloud.byai.gateway.sandbox.mapper.*;
import com.iwhalecloud.byai.gateway.sandbox.persistence.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
class TableDrivenSandboxProfileTest {
    final SandboxServiceSpecEntityMapper specs=mock(SandboxServiceSpecEntityMapper.class);
    final SandboxServiceProfileEntityMapper profiles=mock(SandboxServiceProfileEntityMapper.class);
    final SandboxServiceSpecEntity row=new SandboxServiceSpecEntity();
    final MybatisSandboxServiceSpecRepository repository=new MybatisSandboxServiceSpecRepository(specs,profiles,new SandboxProperties());
    TableDrivenSandboxProfileTest() {
        row.setServiceKey("tenant-opengauss");row.setServiceType("tenant-opengauss");row.setOwnerScope("TENANT");
        row.setEnabled(1);row.setDefaultProfileKey("m");row.setSpecJson("{\"image\":\"test\",\"resourceLimits\":{\"cpu\":\"1\"}}");
        when(specs.selectProfileAwareByServiceKey("tenant-opengauss")).thenReturn(row);
        when(specs.selectLegacyByServiceKey("tenant-opengauss")).thenReturn(row);
    }
    @Test void defaultConfigurationReadsEnabledDatabaseProfile() {
        SandboxServiceProfileEntity p=new SandboxServiceProfileEntity();p.setProfileKey("m");p.setResourceLimits("{\"cpu\":\"2\",\"memory\":\"4Gi\"}");
        when(profiles.selectEnabledProfile("tenant-opengauss","m")).thenReturn(p);
        assertEquals("2",repository.findByServiceKey("tenant-opengauss").get().getResourceLimits().get("cpu"));
        verify(specs,never()).selectLegacyByServiceKey(anyString());
    }
    @Test void disabledServiceCannotLaunch() {
        row.setEnabled(0);
        assertFalse(repository.findByServiceKey("tenant-opengauss").isPresent());
        verifyNoInteractions(profiles);
    }
    @Test void missingOrDisabledRequestedProfileDoesNotFallBackToInlineLimits() {
        assertFalse(repository.findByServiceKeyAndProfile("tenant-opengauss","l").isPresent());
    }
}
