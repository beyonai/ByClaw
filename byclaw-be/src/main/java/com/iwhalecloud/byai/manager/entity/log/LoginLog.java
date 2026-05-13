package com.iwhalecloud.byai.manager.entity.log;

import java.io.Serializable;
import java.util.Date;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

/**
 * 实体类，对应表：po_login_log
 */
@Getter
@Setter
@TableName("po_login_log")
public class LoginLog implements Serializable {
    /** 主键 */
    @TableId(value = "log_id", type = IdType.INPUT)
    private Long logId;

    /** 用户唯一标识，关联用户表主键 */
    private Long userId;

    /** 登录时间，精确到秒*/
    private Date loginTime;

    /** 登出时间，用户主动退出或会话超时自动记录 */
    private Date logoutTime;

    /** 登录IP地址，支持IPv4/IPv6格式 */
    private String ipAddress;

    /** 登录状态：0=成功，1=失败 */
    private Integer status;

    /** 登录失败原因描述，如密码错误、账户锁定等 */
    private String errorReason;

    /** 设备唯一标识，如移动端UUID */
    private String deviceId;

    /** 设备型号，如iPhone 14 Pro、MacBook Pro*/
    private String deviceModel;

    /** 操作系统类型及版本，如Windows 11、iOS 16.4*/
    private String osType;

    /** 浏览器类型及版本，如Chrome 114.0.5735.199 */
    private String browserInfo;

    /** 登录方式,5.用户名称密码 */
    private String loginType;

    /** 会话ID，用于关联用户操作日志*/
    private String sessionId;

    /** 备注信息，可记录特殊情况或自定义信息 */
    private String remark;

}