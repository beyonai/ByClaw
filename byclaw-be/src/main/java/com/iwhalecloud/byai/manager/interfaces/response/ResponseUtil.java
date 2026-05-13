package com.iwhalecloud.byai.manager.interfaces.response;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.annotation.JSONField;
import com.iwhalecloud.byai.common.feign.response.ConversationResponse;
import com.iwhalecloud.byai.common.feign.response.KnowledgeResponse;
import com.iwhalecloud.byai.common.feign.response.ManagerResponse;
import com.fasterxml.jackson.annotation.JsonIgnore;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class ResponseUtil<T> {

    private static final Logger logger = LoggerFactory.getLogger(ResponseUtil.class);


    public static final int SUCCESS = 0;

    public static final int FAIL = -1;

    public static final String RESULTMSG_MSG = "Operation successful";

    private int code;

    @JsonIgnore
    @JSONField(serialize = false)
    private String resultCode;

    private String msg;

    private T data;

    @JsonIgnore
    @JSONField(serialize = false)
    private int errorCode;

    /**
     * 默认构造器
     */
    public ResponseUtil() {
        this.code = SUCCESS;
        this.msg = RESULTMSG_MSG;
    }

    /**
     * 全参构造器
     *
     * @param code 响应编码
     * @param msg 响应描述
     * @param data 响应对象
     */
    public ResponseUtil(int code, String msg, T data) {
        this.code = code;
        this.msg = msg;
        this.data = data;
    }

    /**
     * 成功响应 resultMsg
     *
     * @return ResponseUtil
     */
    public static <T> ResponseUtil<T> success(String resultMsg) {
        return new ResponseUtil<T>(SUCCESS, resultMsg, null);
    }

    /**
     * 成功响应
     *
     * @param data 响应数据
     * @return ResponseUtil
     */
    public static <T> ResponseUtil<T> success(T data) {
        return new ResponseUtil<>(SUCCESS, RESULTMSG_MSG, data);
    }

    /**
     * 成功响应 (带泛型)
     *
     * @param data 响应数据
     * @return ResponseUtil
     */
    public static <T> ResponseUtil<T> successRes(T data) {
        return new ResponseUtil<T>(SUCCESS, RESULTMSG_MSG, data);
    }

    /**
     * 失败响应 (带泛型)
     * 
     * @return ResponseUtil
     */
    public static <T> ResponseUtil<T> failRes(String resultMsg) {
        return new ResponseUtil<T>(FAIL, resultMsg, null);
    }

    /**
     * 失败响应
     * 
     * @param resultMsg 响应信息
     * @return ResponseUtil
     */
    public static <T> ResponseUtil<T> fail(String resultMsg) {
        return new ResponseUtil<T>(FAIL, resultMsg, null);
    }

    /**
     * 失败响应
     *
     * @param resultMsg 响应描述
     * @param data 响应信息
     * @return ResponseUtil
     */
    public static <T> ResponseUtil<T> failResponse(String resultMsg, T data) {
        return new ResponseUtil<T>(FAIL, resultMsg, data);
    }

    /**
     * 成功响应
     *
     * @param data 响应
     * @return ResponseUtil
     */
    public static <T> ResponseUtil<T> successResponse(T data) {
        return new ResponseUtil<T>(SUCCESS, RESULTMSG_MSG, data);
    }

    /**
     * 成功响应
     *
     * @param resultMsg 响应描述
     * @param data 响应返回参数
     * @return ResponseUtil
     */
    public static <T> ResponseUtil<T> successResponse(String resultMsg, T data) {
        return new ResponseUtil<T>(SUCCESS, resultMsg, data);
    }

    /**
     * 成功响应
     *
     * @return ResponseUtil
     */
    public static <T> ResponseUtil<T> successResponse() {
        return new ResponseUtil<T>(SUCCESS, RESULTMSG_MSG, null);
    }

    /**
     * 判断响应是否成功
     *
     * @return true-成功，false-失败
     */
    public boolean isSuccess() {
        return this.code == SUCCESS;
    }

    /**
     * 智能体响应输出
     * 
     * @param knowledgeResponse 智能体响应
     * @return ResponseUtil
     */
    public static <T> ResponseUtil<T> converResponseUtil(KnowledgeResponse<T> knowledgeResponse) {
        if (!KnowledgeResponse.RESPONSE_SUCCESS.equals(knowledgeResponse.getResultCode())) {
            logger.error("智能体返回结果失败:{}", JSON.toJSONString(knowledgeResponse));
            return ResponseUtil.failResponse(knowledgeResponse.getResultMsg(), knowledgeResponse.getResultObject());
        }
        return ResponseUtil.successResponse(knowledgeResponse.getResultMsg(), knowledgeResponse.getResultObject());
    }

    /**
     * 会话响应转换成百应的输出
     * 
     * @param conversationResponse 会话响应
     * @return ResponseUtil
     */
    public static <T> ResponseUtil<T> converResponseUtil(ConversationResponse<T> conversationResponse) {
        String resultMsg = conversationResponse.getResultMsg();
        T resultObject = conversationResponse.getResultObject();
        if (!ConversationResponse.SUCCESS.equals(conversationResponse.getResultCode())) {
            logger.error("会话返回结果失败:{}", JSON.toJSONString(conversationResponse));
            return ResponseUtil.failResponse(resultMsg, resultObject);
        }
        return ResponseUtil.successResponse(resultMsg, resultObject);
    }

    /**
     * 管理端 Feign 响应转换
     */
    public static <T> ResponseUtil<T> converResponseUtil(ManagerResponse<T> managerResponse) {
        if (managerResponse.getCode() == ManagerResponse.SUCCESS) {
            return ResponseUtil.successResponse(managerResponse.getMsg(), managerResponse.getData());
        }
        logger.error("后台管理返回结果失败:{}", JSON.toJSONString(managerResponse));
        return ResponseUtil.fail(managerResponse.getMsg());
    }

}
