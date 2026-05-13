package com.iwhalecloud.byai.common.log.exception;


import static com.iwhalecloud.byai.common.log.exception.ServiceCode.CHATBI_PLATFORM_ERROR;

public class ChaiBiRuntimeExcepion extends BaseRuntimeException {
    public ChaiBiRuntimeExcepion(String errorMsg) {
        super(errorMsg);
    }

    public ChaiBiRuntimeExcepion(Throwable cause) {
        super(CHATBI_PLATFORM_ERROR, cause);
    }
}
