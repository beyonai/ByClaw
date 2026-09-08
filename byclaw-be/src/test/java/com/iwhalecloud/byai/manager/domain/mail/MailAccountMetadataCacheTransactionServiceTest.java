package com.iwhalecloud.byai.manager.domain.mail;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Method;

import org.junit.jupiter.api.Test;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

class MailAccountMetadataCacheTransactionServiceTest {
    @Test
    void refreshBoundaryIsIndependentTransactionBean() throws Exception {
        Method method = MailAccountMetadataCacheTransactionService.class
            .getDeclaredMethod("refreshRequired", Long.class);
        Transactional transactional = method.getAnnotation(Transactional.class);
        assertThat(transactional).isNotNull();
        assertThat(transactional.propagation()).isEqualTo(Propagation.REQUIRES_NEW);
    }
}
