package com.iwhalecloud.byai.common.log.exception;

import static com.iwhalecloud.byai.common.log.exception.ServiceCode.BYAI_MANAGER_PLATFORM_ERROR;

public class ManagerRuntimeException extends BaseRuntimeException {
    public ManagerRuntimeException(String errorMsg) {
        super(errorMsg);
    }

    public ManagerRuntimeException(Throwable cause) {
        super(BYAI_MANAGER_PLATFORM_ERROR, cause);
    }
}
