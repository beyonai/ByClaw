package com.iwhalecloud.byai.state.infrastructure.exception;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

class GlobalExceptionHandlerTest {

    @Test
    void responseStatusException_preservesStatusAndReason() {
        GlobalExceptionHandler handler = new GlobalExceptionHandler();

        var response = handler.handleResponseStatusException(
            new ResponseStatusException(HttpStatus.CONFLICT, "task plan version conflict"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().getCode()).isEqualTo(-1);
        assertThat(response.getBody().getMsg()).isEqualTo("task plan version conflict");
    }
}
