package com.iwhalecloud.byai.common.exception;

import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;

/**
 * @author he.duming
 * @date 2025-08-14 00:47:22
 * @description 参数校验自定义异常
 */
public class ByAiArgumentException extends BaseException {

    /**
     * 百应参数异常校验
     *
     * @param errorMsg 错误信息
     */
    public ByAiArgumentException(String errorMsg) {
        super(CommonErrorCode.ERROR_CODE_50400, errorMsg);
    }

    /**
     * 百应参数异常
     * 
     * @param errorCode 异常编码
     * @param errorMsg 异常信息
     */
    public ByAiArgumentException(int errorCode, String errorMsg) {
        super(errorCode, errorMsg);
    }

    /**
     * 参数异常，抛出异常栈
     * 
     * @param errorMsg 错误信息
     * @param cause 异常栈
     */
    public ByAiArgumentException(String errorMsg, Throwable cause) {
        super(errorMsg, cause);
    }

}
