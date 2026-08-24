package com.iwhalecloud.byai.common.feign.request.datacloud;

import lombok.Getter;
import lombok.Setter;

/**
 * 调用知识库动作请求（POST /api/v1/rpc/kb/invokeAction）。
 */
@Getter
@Setter
public class InvokeActionReq {
    public InvokeActionReq() {
        this.params = new Params();
    }

    private Params params;
}
