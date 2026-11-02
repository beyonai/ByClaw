package com.iwhalecloud.byai.manager.domain.operations;

import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.exception.BaseException;

/** 服务间仅传递白名单失败类别，不向运营端泄露执行服务异常。
 * @author Codex
 * @since 2026-10-23
 */
public class OperationsFailure extends BaseException {
    private final String kind;

    /** 创建可安全转发的业务失败。 */
    public OperationsFailure(String kind) {
        super(CommonErrorCode.ERROR_CODE_50500, "operations.request.failed");
        this.kind = kind;
    }

    /** 获取跨服务失败类别。 */
    public String getKind() {
        return kind;
    }
}

