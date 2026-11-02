package com.iwhalecloud.byai.state.common.exception;

import java.util.ResourceBundle;
import java.util.Map;

/** Rejected before the business operation starts; clients may wait and retry explicitly. */
public final class StoragePreparingException extends BdpRuntimeException {
    public StoragePreparingException(){super(ResourceBundle.getBundle("i18n.messages",org.springframework.context.i18n.LocaleContextHolder.getLocale()).getString("storage.personal.preparing"));}
    public Map<String,Object> details(){return Map.of("errorType","STORAGE_PREPARING","retryAfterMs",15000);}
}
