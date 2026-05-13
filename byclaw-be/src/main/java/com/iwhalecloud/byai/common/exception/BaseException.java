package com.iwhalecloud.byai.common.exception;

import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import lombok.Getter;
import lombok.Setter;

/**
 * 基础异常类
 */
@Setter
@Getter
public class BaseException extends RuntimeException {

    protected int errorCode;

    protected String errorMsg;

    /**
     * 基础异常
     * 
     * @param errorMsg 错误信息
     */
    public BaseException(String errorMsg) {
        super(errorMsg);
        this.errorCode = CommonErrorCode.ERROR_CODE_50500;
        this.errorMsg = errorMsg;
    }

    public BaseException(int errorCode, String errorMsg) {
        super(errorMsg);
        this.errorCode = errorCode;
        this.errorMsg = errorMsg;
    }

    public BaseException(String errorMsg, Throwable cause) {
        super(errorMsg, cause);
        this.errorCode = CommonErrorCode.ERROR_CODE_50500;
        this.errorMsg = errorMsg;
    }

    public BaseException(int errorCode, String errorMsg, Throwable cause) {
        super(errorMsg, cause);
        this.errorCode = errorCode;
        this.errorMsg = errorMsg;
    }

    public String getErrorMsg() {
        return I18nUtil.get(this.errorMsg);
    }

    @Override
    public String getMessage() {
        return I18nUtil.get(this.errorMsg);
    }
}
