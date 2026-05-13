package com.iwhalecloud.byai.manager.entity.source;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * @author he.duming
 * @date 2025-05-29 17:08:44
 * @description 外部系统配置实体类，对应数据库表 po_source_system 记录与第三方系统集成所需的配置信?
 */

@Getter
@Setter
@TableName("po_source_system")
public class SourceSystem {

    /**
     * 唯一标识
     */
    @TableId(value = "po_external_system_id", type = IdType.INPUT)
    private Long poExternalSystemId;

    /**
     * 系统编码
     */
    private String systemCode;

    /**
     * 系统名称
     */
    private String systemName;

    /**
     * 单点登录地址
     */
    private String ssoUrl;

    /**
     * 应用编码
     */
    private String appKey;

    /**
     * 应用秘钥
     */
    private String appSecret;

    /**
     * toke获取地址
     */
    private String getTokenUrl;

    /**
     * 票据更新地址
     */
    private String refreshTokenUrl;

    /**
     * 创建时间
     */
    private Date createTime;

    /**
     * 创建人
     */
    private Long createUser;

    /**
     * 所属企业
     */
    private Long comAcctId;

    /**
     * OAuth2回调地址
     */
    private String redirectUri;

    /**
     * 是否开启授?
     */
    private String enabled;

    /**
     * 获取用户信息的URL地址
     */
    private String userInfoUrl;

}
