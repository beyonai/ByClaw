package com.iwhalecloud.byai.state.common.exception;

import com.iwhalecloud.byai.common.log.exception.BaseRuntimeException;

/**
 * 运行时异常
 */
public class BdpRuntimeException extends BaseRuntimeException {

    public BdpRuntimeException(String errMsg) {
        super(errMsg);
    }

    public BdpRuntimeException(String errMsg, Exception e) {
        super(errMsg, e);
    }

    public BdpRuntimeException(String message, Throwable cause) {
        super(message, cause);
    }
}
