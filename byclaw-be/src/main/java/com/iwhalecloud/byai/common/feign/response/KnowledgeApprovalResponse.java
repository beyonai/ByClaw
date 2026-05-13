package com.iwhalecloud.byai.common.feign.response;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-12-25 21:06:14
 * @description 审核接口单独定义，返回值不一样
 */
@Getter
@Setter
public class KnowledgeApprovalResponse<T> {

    /**
     * 审核成功编码
     */
    public static final Integer RESPONSE_SUCCESS = 200;

    /**
     * 审核异常编码
     */
    public static final Integer RESPONSE_FAIL = 200;

    /**
     * 结果代码
     */
    private Integer code;

    /**
     * 结果消息
     */
    private String msg;

    /**
     * 结果对象
     */
    private T data;
}
