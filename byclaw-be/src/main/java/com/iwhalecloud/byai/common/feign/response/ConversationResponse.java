package com.iwhalecloud.byai.common.feign.response;

import lombok.Getter;
import lombok.Setter;
import java.io.Serializable;

/**
 * 会话引擎接口响应对象
 *
 * @author hu.weixiong
 * @param <T>
 */
@Getter
@Setter
public class ConversationResponse<T> implements Serializable {

    public static final String SUCCESS = "0";

    private T resultObject;

    private String resultCode;

    private String resultMsg;

}
