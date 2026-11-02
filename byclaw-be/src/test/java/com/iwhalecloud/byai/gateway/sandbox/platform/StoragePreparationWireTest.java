package com.iwhalecloud.byai.gateway.sandbox.platform;

import com.iwhalecloud.byai.state.common.exception.StoragePreparingException;
import java.util.Locale;
import org.junit.jupiter.api.Test;
import org.springframework.context.i18n.LocaleContextHolder;
import static org.assertj.core.api.Assertions.*;

class StoragePreparationWireTest {
    @Test void readinessErrorsCarryStableCodeAndBothLocalesWithoutApplicationContext() {
        try {
            LocaleContextHolder.setLocale(Locale.US);
            assertThat(new StoragePreparingException().getMessage()).contains("storage");
            LocaleContextHolder.setLocale(Locale.SIMPLIFIED_CHINESE);
            StoragePreparingException error=new StoragePreparingException();
            assertThat(error.getMessage()).contains("网盘");
            assertThat(error.details()).containsEntry("errorType","STORAGE_PREPARING");
        } finally {LocaleContextHolder.resetLocaleContext();}
    }
}
