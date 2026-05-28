package com.iwhalecloud.byai.gateway.sandbox.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.HashMap;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;

import com.iwhalecloud.byai.gateway.sandbox.model.opendesign.OpenDesignRedirectResult;
import com.iwhalecloud.byai.gateway.sandbox.service.OpenDesignRedirectService;
import com.iwhalecloud.byai.gateway.sandbox.service.exception.OpenDesignAdapterException;

class RedirectAdapterControllerTest {

    private RedirectAdapterController controller;
    private OpenDesignRedirectService openDesignRedirectService;

    @BeforeEach
    void setUp() {
        openDesignRedirectService = mock(OpenDesignRedirectService.class);
        controller = new RedirectAdapterController(openDesignRedirectService);
    }

    @Test
    void openDesignAdapterPost_mergesBodyOverQuery() {
        when(openDesignRedirectService.prepareRedirect(anyMap()))
            .thenReturn(new OpenDesignRedirectResult("/openDesign/"));

        Map<String, String> queryParams = new HashMap<>();
        queryParams.put("sessionId", "query-session");
        queryParams.put("prompt", "query prompt");

        Map<String, Object> bodyParams = new HashMap<>();
        bodyParams.put("sessionId", "body-session");
        bodyParams.put("prompt", "body prompt");

        ResponseEntity<?> response = controller.openDesignAdapterPost(queryParams, bodyParams,
            new MockHttpServletRequest());

        ArgumentCaptor<Map<String, Object>> captor = ArgumentCaptor.forClass(Map.class);
        verify(openDesignRedirectService).prepareRedirect(captor.capture());
        assertThat(captor.getValue())
            .containsEntry("sessionId", "body-session")
            .containsEntry("prompt", "body prompt");
        assertThat(response.getStatusCode().value()).isEqualTo(302);
        assertThat(response.getHeaders().getFirst("Location")).isEqualTo("/openDesign/");
    }

    @Test
    void openDesignAdapterPost_prefixesContextPathForRelativeRedirect() {
        when(openDesignRedirectService.prepareRedirect(anyMap()))
            .thenReturn(new OpenDesignRedirectResult("/openDesign/projects/p1"));

        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setContextPath("/byaiService");

        ResponseEntity<?> response = controller.openDesignAdapterPost(new HashMap<>(), null, request);

        assertThat(response.getStatusCode().value()).isEqualTo(302);
        assertThat(response.getHeaders().getFirst("Location")).isEqualTo("/byaiService/openDesign/projects/p1");
    }

    @Test
    void openDesignAdapterGet_returnsStructuredJsonOnFailure() {
        when(openDesignRedirectService.prepareRedirect(anyMap()))
            .thenThrow(new OpenDesignAdapterException(400, "Open Design endpoint is required"));

        ResponseEntity<?> response = controller.openDesignAdapterGet(new HashMap<String, String>(),
            new MockHttpServletRequest());

        assertThat(response.getStatusCode().value()).isEqualTo(400);
        assertThat(response.getBody()).isInstanceOf(Map.class);
        @SuppressWarnings("unchecked")
        Map<String, Object> body = (Map<String, Object>) response.getBody();
        assertThat(body).containsEntry("error", "Open Design endpoint is required");
        assertThat(body).containsKey("requestId");
    }
}
