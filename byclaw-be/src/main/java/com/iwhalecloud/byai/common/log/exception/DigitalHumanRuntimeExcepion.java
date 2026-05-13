package com.iwhalecloud.byai.common.log.exception;


import static com.iwhalecloud.byai.common.log.exception.ServiceCode.DIGITAL_HUMAN_ERROR;

public class DigitalHumanRuntimeExcepion extends BaseRuntimeException {
    public DigitalHumanRuntimeExcepion(String errorMsg) {
        super(errorMsg);
    }

    public DigitalHumanRuntimeExcepion(Throwable cause) {
        super(DIGITAL_HUMAN_ERROR, cause);
    }
}
