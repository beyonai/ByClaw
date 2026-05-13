package com.iwhalecloud.byai.common.feign.response;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-11-24 10:07:41
 * @description 调度响应结果封装类
 */
@Getter
@Setter
public class ScheduleResponse {

    public static final String SUCCESS = "0";

    public static final String FAIL = "-1";

    private String resultCode;

    private String resultMsg;

    public Object resultObject;

}
