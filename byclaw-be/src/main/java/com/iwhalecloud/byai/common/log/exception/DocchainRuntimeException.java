package com.iwhalecloud.byai.common.log.exception;

import static com.iwhalecloud.byai.common.log.exception.ServiceCode.DOCCHAIN_PLATFORM_ERROR;

public class DocchainRuntimeException extends BaseRuntimeException {
    public DocchainRuntimeException(String errorMsg) {
        super(errorMsg);
    }

    public DocchainRuntimeException(Throwable cause) {
        super(DOCCHAIN_PLATFORM_ERROR, cause);
    }
}
