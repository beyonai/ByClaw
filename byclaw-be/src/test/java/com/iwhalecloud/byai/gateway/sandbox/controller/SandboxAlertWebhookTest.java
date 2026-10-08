package com.iwhalecloud.byai.gateway.sandbox.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.iwhalecloud.byai.gateway.sandbox.service.SandboxResizeService;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxResizeRecord;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class SandboxAlertWebhookTest {
    @Test
    void failedRecoveryReturnsRetryableStatusToAlertmanager() throws Exception {
        SandboxResizeService service = mock(SandboxResizeService.class);
        SsSandboxResizeRecord failed = new SsSandboxResizeRecord();
        failed.setStatus("FAILED");
        failed.setErrorMessage("OpenSandbox unavailable");
        when(service.handlePrometheusAlert(any())).thenReturn(failed);
        webhook(service).perform(post("/sandbox/autoscale/alerts")
            .contentType(MediaType.APPLICATION_JSON).content("{}"))
            .andExpect(status().isServiceUnavailable());
    }

    @Test
    void handlerExceptionReturnsRetryableStatusToAlertmanager() throws Exception {
        SandboxResizeService service = mock(SandboxResizeService.class);
        when(service.handlePrometheusAlert(any())).thenThrow(new IllegalStateException("database unavailable"));
        webhook(service).perform(post("/sandbox/autoscale/alerts")
            .contentType(MediaType.APPLICATION_JSON).content("{}"))
            .andExpect(status().isServiceUnavailable());
    }

    @Test
    void staleAlertAcknowledgesWithoutRetry() throws Exception {
        SandboxResizeService service = mock(SandboxResizeService.class);
        SsSandboxResizeRecord skipped = new SsSandboxResizeRecord();
        skipped.setStatus("SKIPPED_STALE");
        when(service.handlePrometheusAlert(any())).thenReturn(skipped);
        webhook(service).perform(post("/sandbox/autoscale/alerts")
            .contentType(MediaType.APPLICATION_JSON).content("{}"))
            .andExpect(status().isOk());
    }

    private MockMvc webhook(SandboxResizeService service) {
        SandboxController controller = new SandboxController();
        ReflectionTestUtils.setField(controller, "sandboxResizeService", service);
        return MockMvcBuilders.standaloneSetup(controller).build();
    }
}
