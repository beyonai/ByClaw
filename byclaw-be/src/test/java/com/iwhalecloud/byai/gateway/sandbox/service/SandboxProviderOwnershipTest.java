package com.iwhalecloud.byai.gateway.sandbox.service;

import com.iwhalecloud.byai.gateway.sandbox.client.OpenSandboxClient;
import com.iwhalecloud.byai.gateway.sandbox.config.SandboxProperties;
import com.iwhalecloud.byai.gateway.sandbox.runtime.OpenSandboxRuntimeProvider;
import com.iwhalecloud.byai.gateway.sandbox.runtime.StandardSandboxLifecycleService;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class SandboxProviderOwnershipTest {
    @Test
    void openSandboxReconcileMustNotMarkAnAcsRecordMissing() {
        SsSandboxRecordMapper mapper = mock(SsSandboxRecordMapper.class);
        OpenSandboxClient client = mock(OpenSandboxClient.class);
        SandboxService service = new SandboxService();
        ReflectionTestUtils.setField(service, "sandboxRecordMapper", mapper);
        ReflectionTestUtils.setField(service, "sandboxLifecycleFacade", new StandardSandboxLifecycleService(
            new SandboxProperties(), null, null, null, new OpenSandboxRuntimeProvider(client)));
        SsSandboxRecord record = new SsSandboxRecord();
        record.setId(1L); record.setUserCode("u"); record.setSandboxType("byclaw-dsh");
        record.setSandboxId("test-ns--byclaw-0123456789abcdef0123456789abcdef01234567");
        record.setStatus("RUNNING"); record.setLockVersion(0);
        SandboxLifecycleJobReport report = new SandboxLifecycleJobReport("test");
        ReflectionTestUtils.invokeMethod(service, "reconcileRecordFromRemoteMap", record, null, report);
        verifyNoInteractions(mapper, client);
        assertThat(report.getSkippedCount()).isEqualTo(1);
        assertThat(record.getStatus()).isEqualTo("RUNNING");
    }
    @Test
    void foreignSandboxCannotBeMarkedReleasingByManualRemoval() {
        SsSandboxRecordMapper mapper = mock(SsSandboxRecordMapper.class);
        SandboxService service = new SandboxService();
        ReflectionTestUtils.setField(service, "sandboxRecordMapper", mapper);
        ReflectionTestUtils.setField(service, "sandboxLifecycleFacade", new StandardSandboxLifecycleService(
            new SandboxProperties(), null, null, null, new OpenSandboxRuntimeProvider(mock(OpenSandboxClient.class))));
        SsSandboxRecord record = new SsSandboxRecord();
        record.setSandboxId("test-ns--byclaw-0123456789abcdef0123456789abcdef01234567");
        assertThatThrownBy(() -> ReflectionTestUtils.invokeMethod(service, "doRemoveSandbox", record, "release.manual"))
            .isInstanceOf(IllegalStateException.class).hasMessageContaining("another execution engine");
        verifyNoInteractions(mapper);
    }

}
