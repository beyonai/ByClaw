package com.iwhalecloud.byai.common.feign.request.sandbox;


import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;
import java.util.Map;

/**
 * 沙箱启动请求参数
 * 使用NON_NULL策略，未设置的字段（如chat_id）不会序列化为null，避免服务端校验失败
 */
@Data
public class SandboxLaunchRequest {

    /** 沙箱类型 */
    @JsonProperty("sandbox_type")
    private String sandboxType;

    /** 用户编码 */
    @JsonProperty("user_code")
    private String userCode;

//    /** 会话ID */
//    @JsonProperty("chat_id")
//    private String chatId;

    /** 是否自动释放：1-自动释放，0-不自动（特权用户长期沙箱）。序列化必须为 JSON 数字，不能为字符串 */
    @JsonProperty("auto_release")
    private Integer autoRelease;

    /** 沙箱专用参数 */
    @JsonProperty("envs")
    private Map<String, String> envs;

    @JsonProperty("user_info")
    private Map<String, Object> userInfo;
}
