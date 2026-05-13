package com.iwhalecloud.byai.common.log.exception;

import static com.iwhalecloud.byai.common.log.exception.ServiceCode.CHATBI_PLATFORM_ERROR;

public class XssRuntimeException extends BaseRuntimeException {

    public XssRuntimeException(String errorMsg) {
        super(errorMsg);
    }

    public XssRuntimeException(Throwable cause) {
        super(CHATBI_PLATFORM_ERROR, cause);
    }
}
