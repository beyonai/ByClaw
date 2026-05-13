package com.iwhalecloud.byai.common.feign.response;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.Data;

import java.io.Serializable;

@Data
@JsonInclude(JsonInclude.Include.NON_NULL)
public class BiResponse<T> implements Serializable {

    /**
     * 智能体响应成功
     */
    public static final String RESPONSE_SUCCESS = "0";

    private T resultObject;

    private String resultCode;

    private String resultMsg;

    private String errorCode;

}
