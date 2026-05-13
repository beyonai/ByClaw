package com.iwhalecloud.byai.common.log.exception;


import static com.iwhalecloud.byai.common.log.exception.ServiceCode.MEMORY_SYSTEM_MESSAGE_ERROR;
import static com.iwhalecloud.byai.common.log.exception.ServiceCode.MEMORY_SYSTEM_SEARCH_ERROR;

public class MemoryRuntimeException extends BaseRuntimeException {
    public MemoryRuntimeException(String errorMsg) {
        super(errorMsg);
    }


    public MemoryRuntimeException(String errorService, Throwable cause) {
        super(errorService, cause);
    }

    public static MemoryRuntimeException messageRuntimeException(Throwable cause) {
        return new MemoryRuntimeException(MEMORY_SYSTEM_MESSAGE_ERROR, cause);
    }

    public static MemoryRuntimeException searchRuntimeException(Throwable cause) {
        return new MemoryRuntimeException(MEMORY_SYSTEM_SEARCH_ERROR, cause);
    }

}
