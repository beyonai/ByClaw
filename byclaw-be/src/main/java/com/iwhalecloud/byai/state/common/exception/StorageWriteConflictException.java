package com.iwhalecloud.byai.state.common.exception;

import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Only a verified write-coordination conflict uses this business message. */
public final class StorageWriteConflictException extends ResponseStatusException {
    private final String errorType;
    public StorageWriteConflictException(int status,String errorType) {
        super(HttpStatus.valueOf(status),"文件写入中，请稍后再试");this.errorType=errorType;
    }
    public Map<String,Object> details(){return Map.of("errorType",errorType,"retryAfterMs",1000);}
}
