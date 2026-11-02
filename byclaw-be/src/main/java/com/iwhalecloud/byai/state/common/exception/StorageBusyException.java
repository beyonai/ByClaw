package com.iwhalecloud.byai.state.common.exception;

import java.util.Map;
import java.util.ResourceBundle;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Temporary storage admission contention, distinct from a missing object or quota admission. */
public final class StorageBusyException extends ResponseStatusException {
    public StorageBusyException() {
        super(HttpStatus.SERVICE_UNAVAILABLE, "STORAGE_BUSY");
    }

    public String publicMessage() {
        return ResourceBundle.getBundle("i18n.messages", LocaleContextHolder.getLocale())
            .getString("storage.file.busy");
    }

    public Map<String, Object> details() {
        return Map.of("errorType", "STORAGE_BUSY", "retryAfterMs", 1000);
    }
}
