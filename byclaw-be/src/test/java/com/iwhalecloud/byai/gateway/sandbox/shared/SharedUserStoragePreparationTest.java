package com.iwhalecloud.byai.gateway.sandbox.shared;

import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class SharedUserStoragePreparationTest {
    @Test void quotaControllerUsesWorkspaceQueryWithoutPreparationPolicy() {
        var policy = mock(SharedSandboxPolicy.class);
        var gateway = mock(SharedSandboxGateway.class);
        var sandboxes = mock(SandboxService.class);
        var service = new SharedUserStoragePreparation(policy, gateway, sandboxes, Runnable::run);
        var controller = new com.iwhalecloud.byai.state.interfaces.controller.personalmodel.PersonalModelController();
        org.springframework.test.util.ReflectionTestUtils.setField(controller, "sharedUserStoragePreparation", service);
        var login = new LoginInfo();
        login.setUserCode("0027003719");
        login.setUserId(10000029L);
        when(gateway.workspaceSpaceStatus("0027003719")).thenReturn(Map.of("enabled", true));
        com.iwhalecloud.byai.common.login.auth.CurrentUserHolder.setLoginInfo(login);
        try {
            controller.storageQuota();
            verify(gateway).workspaceSpaceStatus("0027003719");
            verify(gateway, never()).userStorageStatus(anyString());
            verifyNoInteractions(policy, sandboxes);
        } finally {
            com.iwhalecloud.byai.common.login.auth.CurrentUserHolder.setLoginInfo(null);
        }
    }

    @Test void loginCapturesTenantAndDoesNotWaitForNasOrRequireAutoStart() {
        var policy=mock(SharedSandboxPolicy.class);var gateway=mock(SharedSandboxGateway.class);
        var sandboxes=mock(SandboxService.class);List<Runnable> queue=new ArrayList<>();
        var service=new SharedUserStoragePreparation(policy,gateway,sandboxes,queue::add);
        var login=new LoginInfo();login.setUserCode("alice");login.setUserId(7L);login.setEnterpriseId(9L);
        service.trigger(login);assertThat(queue).isEmpty();verifyNoInteractions(gateway,sandboxes);
        when(policy.userNasEnabled("alice","byclaw-dsh")).thenReturn(true);
        when(sandboxes.getPreferredServiceKey("alice")).thenReturn("byclaw-dsh");
        service.trigger(login);service.trigger(login);assertThat(queue).hasSize(1);
        verifyNoInteractions(gateway);login.setEnterpriseId(99L);queue.remove(0).run();
        verify(gateway).call(eq("prepareUserStorage"),argThat(p->Long.valueOf(9).equals(p.get("enterpriseId"))));
        service.trigger(login);assertThat(queue).hasSize(1);
    }
    @Test void nonDshUsersDoNotSeeAStorageJobThatWasNeverScheduled() {
        var policy=mock(SharedSandboxPolicy.class);var gateway=mock(SharedSandboxGateway.class);
        var sandboxes=mock(SandboxService.class);
        var service=new SharedUserStoragePreparation(policy,gateway,sandboxes,Runnable::run);
        when(policy.userNasEnabled("alice","byclaw-dsh")).thenReturn(true);
        assertThat(service.status("alice")).containsEntry("enabled",false);
        when(sandboxes.getPreferredServiceKey("alice")).thenReturn("openclaw");
        assertThat(service.status("alice")).containsEntry("enabled",false);
        verifyNoInteractions(gateway);
    }
    @Test void firstLoginPreparesPersonalNasBeforeAServicePreferenceExists() {
        var policy=mock(SharedSandboxPolicy.class);var gateway=mock(SharedSandboxGateway.class);
        var sandboxes=mock(SandboxService.class);
        var service=new SharedUserStoragePreparation(policy,gateway,sandboxes,Runnable::run);
        var login=new LoginInfo();login.setUserCode("alice");login.setUserId(7L);login.setEnterpriseId(9L);
        when(policy.userNasEnabled("alice","byclaw-dsh")).thenReturn(true);
        service.trigger(login);
        verify(gateway).call(eq("prepareUserStorage"),argThat(p->"alice".equals(p.get("userCode"))));
    }
    @Test void disabledWhileQueuedCancelsPreparation() {
        var policy=mock(SharedSandboxPolicy.class);var gateway=mock(SharedSandboxGateway.class);
        var sandboxes=mock(SandboxService.class);List<Runnable> queue=new ArrayList<>();
        var service=new SharedUserStoragePreparation(policy,gateway,sandboxes,queue::add);
        var login=new LoginInfo();login.setUserCode("alice");login.setUserId(7L);login.setEnterpriseId(9L);
        when(policy.userNasEnabled("alice","byclaw-dsh")).thenReturn(true,false);
        service.trigger(login);queue.get(0).run();verifyNoInteractions(gateway,sandboxes);
    }
}
