package com.iwhalecloud.byai.common.feign.response;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2026-03-01 00:01:17
 * @description TODO
 */
@Getter
@Setter
public class ApprovalNotifyResponse<T> {

    private T resultObject;

    protected T data;

    private String resultCode;

    private String resultMsg;
}
