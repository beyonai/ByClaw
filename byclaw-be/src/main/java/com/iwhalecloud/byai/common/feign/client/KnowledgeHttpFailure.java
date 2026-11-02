package com.iwhalecloud.byai.common.feign.client;

import com.iwhalecloud.byai.common.exception.BaseException;
import java.util.Set;

/** 保留知识服务 HTTP 拒绝类型，区分未受理与超时后结果未知。 @author Codex @since 2026-11-02 */
public class KnowledgeHttpFailure extends BaseException {
    private final int status;

    public KnowledgeHttpFailure(int status, String message) {
        super(message);
        this.status = status;
    }

    /** 按知识服务契约，参数、身份、路径拒绝不会产生部分导入；部分导入返回逐项结果。 */
    public boolean isDefiniteRejection() {
        return Set.of(400, 401, 403, 404, 405, 413, 415, 422).contains(status);
    }
}
