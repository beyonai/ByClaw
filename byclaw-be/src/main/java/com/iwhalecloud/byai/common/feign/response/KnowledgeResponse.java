package com.iwhalecloud.byai.common.feign.response;

import com.iwhalecloud.byai.common.util.MapParamUtil;
import lombok.Getter;
import lombok.Setter;
import java.util.Map;

@Setter
@Getter
public class KnowledgeResponse<T> {

    /**
     * 智能体响应成功编码
     */
    public static final String RESPONSE_SUCCESS = "0";

    /**
     * 智能体响应失败
     */
    public static final String RESPONSE_FAIL = "-1";

    /**
     * 结果代码
     */
    private String resultCode;

    /**
     * 结果消息
     */
    private String resultMsg;

    /**
     * 结果对象
     */
    private T resultObject;

    public static <T> KnowledgeResponse<T> success(T resultObject) {
        KnowledgeResponse<T> knowledgeResponse = new KnowledgeResponse<T>();
        knowledgeResponse.setResultCode(RESPONSE_SUCCESS);
        knowledgeResponse.setResultObject(resultObject);
        return knowledgeResponse;
    }

    /**
     * 从响应中获取对就值
     *
     * @param key 关键值
     * @return Long
     */
    public Long getResponseLongValue(String key) {
        Map<String, Object> resultObjectMap = (Map<String, Object>) resultObject;
        return MapParamUtil.getLongValue(resultObjectMap, key);
    }
}
