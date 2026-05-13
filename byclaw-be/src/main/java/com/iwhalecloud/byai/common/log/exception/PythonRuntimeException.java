package com.iwhalecloud.byai.common.log.exception;

import lombok.Getter;
import lombok.ToString;

/**
 * @author zht
 * @version 1.0
 * @date 2025/5/28
 */
@Getter
@ToString
public class PythonRuntimeException extends BaseRuntimeException {

    private final Integer errorCode;

    private final String traceback;

    private final String path;

    private final String errorMsg;

    private final String timestamp;

    public PythonRuntimeException(String errorMsg, Integer errorCode, String traceback, String path, String timestamp) {
        super(errorMsg);
        this.errorMsg = errorMsg;
        this.errorCode = errorCode;
        this.traceback = traceback;
        this.path = path;
        this.timestamp = timestamp;
    }

    public String getServiceCode() {
        int code = this.errorCode / 1000;
        if (code == 1) {
            return ServiceCode.Module.APP_BY;
        }
        else if (code == 2) {
            return ServiceCode.Module.APP_MEMORY_SEARCH;
        }
        else if (code == 3) {
            return ServiceCode.Module.APP_DOCCHAIN;
        }
        else if (code == 4) {
            return ServiceCode.Module.APP_CHATBI;
        }
        else if (code == 5) {
            return ServiceCode.Module.APP_WRITER;
        }
        else if (code == 6) {
            return ServiceCode.Module.APP_AGENT;
        }
        else if (code == 7) {
            return ServiceCode.Module.APP_DH;
        }
        else {
            return ServiceCode.Module.APP_BY;
        }
    }

}
