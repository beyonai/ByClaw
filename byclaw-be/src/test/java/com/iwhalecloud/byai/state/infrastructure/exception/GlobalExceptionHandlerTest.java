package com.iwhalecloud.byai.state.infrastructure.exception;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.AccessDeniedException;

import com.iwhalecloud.byai.common.storage.exception.StorageQuotaExceededException;

class GlobalExceptionHandlerTest {

    private final GlobalExceptionHandler handler = new GlobalExceptionHandler();

    @Test
    void storageQuotaDenialUsesInsufficientStorageStatus() {
        assertThat(handler.handleStorageQuotaExceeded(new StorageQuotaExceededException("quota exceeded")).getStatusCode())
            .isEqualTo(HttpStatus.INSUFFICIENT_STORAGE);
    }

    @Test
    void adminDenialUsesForbiddenStatus() {
        assertThat(handler.handleAccessDenied(new AccessDeniedException("forbidden")).getStatusCode())
            .isEqualTo(HttpStatus.FORBIDDEN);
    }
}
