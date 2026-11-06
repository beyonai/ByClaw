package com.iwhalecloud.byai.gateway.sandbox.platform;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.state.infrastructure.exception.GlobalExceptionHandler;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mock.web.MockHttpServletResponse;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class StorageUploadAdmissionWireTest extends com.iwhalecloud.byai.common.i18n.I18nTestSupport {
    @Test void admissionFullSurvivesBothHttpBoundariesWithBoundedRetryMetadata() {
        var execution = mock(PlatformBackgroundExecution.class);
        var gateway = new PlatformRemoteGateway(execution, mock(ObjectProvider.class), new ObjectMapper(),
            new MockEnvironment().withProperty("byclaw.platform.base-url", "http://platform.invalid"));
        var failure = mock(feign.FeignException.class);
        when(failure.status()).thenReturn(429);
        when(failure.contentUTF8()).thenReturn("{\"data\":{\"errorType\":\"upload_admission_full\"}}");
        when(failure.responseHeaders()).thenReturn(Map.of("retry-after", List.of("3")));
        assertThatThrownBy(() -> gateway.safe(() -> { throw failure; }))
            .isInstanceOfSatisfying(com.iwhalecloud.byai.state.common.exception.StorageUploadAdmissionException.class, typed -> {
                var response = new GlobalExceptionHandler().storageUploadAdmission(typed, new MockHttpServletResponse());
                assertThat(response.getStatusCode().value()).isEqualTo(429);
                assertThat(response.getHeaders().getFirst("Retry-After")).isEqualTo("3");
                Map<?, ?> details=(Map<?, ?>) response.getBody().getData();
                assertThat(details.get("errorType")).isEqualTo("upload_admission_full");
                assertThat(details.get("retryAfterMs")).isEqualTo(3000L);
                assertThat(details.get("action")).isEqualTo("MANAGE_UNFINISHED_UPLOADS");
            });
    }
    @Test void writeBusyRetainsRetryAndMalformedAdmissionRetryIsBounded() {
        var gateway = new PlatformRemoteGateway(mock(PlatformBackgroundExecution.class), mock(ObjectProvider.class),
            new ObjectMapper(),new MockEnvironment().withProperty("byclaw.platform.base-url", "http://platform.invalid"));
        var failure = mock(feign.FeignException.class);
        when(failure.status()).thenReturn(423);
        when(failure.contentUTF8()).thenReturn("{\"data\":{\"errorType\":\"file_write_in_progress\"}}");
        when(failure.responseHeaders()).thenReturn(Map.of("Retry-After", List.of("7")));
        assertThatThrownBy(() -> gateway.safe(() -> { throw failure; }))
            .isInstanceOfSatisfying(com.iwhalecloud.byai.state.common.exception.StorageWriteConflictException.class, typed -> {
                var response=new GlobalExceptionHandler().storageWriteConflict(typed,new MockHttpServletResponse());
                assertThat(response.getStatusCode().value()).isEqualTo(423);
                assertThat(response.getHeaders().getFirst("Retry-After")).isEqualTo("7");
                assertThat(typed.details().get("retryAfterMs")).isEqualTo(7000L);
            });
        when(failure.status()).thenReturn(429);
        when(failure.contentUTF8()).thenReturn("{\"data\":{\"errorType\":\"upload_admission_full\"}}");
        for(String invalid:List.of("-1","bad","3601","9999999999")) {
            when(failure.responseHeaders()).thenReturn(Map.of("Retry-After",List.of(invalid)));
            assertThatThrownBy(() -> gateway.safe(() -> { throw failure; }))
                .isInstanceOfSatisfying(com.iwhalecloud.byai.state.common.exception.StorageUploadAdmissionException.class,
                    typed -> assertThat(typed.getRetryAfter()).isEqualTo("1"));
        }
    }
    @Test void unrelatedOrMalformed429IsNeverPresentedAsKnownSessionAdmission() {
        var gateway = new PlatformRemoteGateway(mock(PlatformBackgroundExecution.class), mock(ObjectProvider.class),
            new ObjectMapper(),new MockEnvironment().withProperty("byclaw.platform.base-url", "http://platform.invalid"));
        var failure=mock(feign.FeignException.class);when(failure.status()).thenReturn(429);
        for(String body:List.of("null","","not-json","{\"data\":{\"errorType\":\"other_rate_limit\"}}")) {
            when(failure.contentUTF8()).thenReturn(body);
            assertThatThrownBy(() -> gateway.safe(() -> {throw failure;}))
                .isInstanceOf(com.iwhalecloud.byai.state.common.exception.BdpRuntimeException.class);
        }
    }
}
