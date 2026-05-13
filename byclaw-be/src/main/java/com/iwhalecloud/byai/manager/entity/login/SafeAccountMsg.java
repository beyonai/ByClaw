package com.iwhalecloud.byai.manager.entity.login;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import java.util.Date;

@Data
@TableName("po_safe_account_msg")
public class SafeAccountMsg {

    /**
     * 验证码状态常量
     */
    public static final String STATE_SEND_SUCCESS = "1"; // 发送成功

    public static final String STATE_SEND_FAIL = "2"; // 发送失败

    public static final String STATE_EXPIRED = "3"; // 已过期（已使用）

    @TableId(value = "msg_id", type = IdType.INPUT)
    private Long msgId;

    /**
     * 用户编码--手机号
     */
    private String phone;

    /**
     * 验证码内容(SM4加密)
     */
    private String verifyCode;

    /**
     * 消息类型(1:登录验证码,2:注册验证码)
     */
    private String msgType;

    /**
     * 创建时间
     */
    private Date createDate;

    /**
     * 状态：1: 发送成功,2: 发送失败,3: 已过期（已使用）
     */
    private String state;

    /**
     * 有效分钟数
     */
    private Integer effectiveMinutes;

    /**
     * 发送时间
     */
    private Date sendDate;

    /**
     * 失效时间
     */
    private Date expireDate;
}