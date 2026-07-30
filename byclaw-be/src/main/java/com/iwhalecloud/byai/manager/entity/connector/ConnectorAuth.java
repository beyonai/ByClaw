package com.iwhalecloud.byai.manager.entity.connector;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.annotation.JsonFormat;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * 用户连接器授权绑定记录。
 */
@Getter
@Setter
@TableName("byai_connector_auth")
public class ConnectorAuth {

    /** 主键，业务层生成 */
    @TableId(value = "auth_id", type = IdType.INPUT)
    private Long authId;

    /** 归属用户ID */
    private String userId;

    /** 关联 byai_connector_info.connector_id */
    private Long connectorId;

    /** 用户自定义授权账号别名 */
    private String authName;

    /** 授权方式（冗余）：NONE、OAUTH2、AK_SK、PASSWORD、TOKEN，允许为空 */
    private String authMode;

    /** 加密后的授权凭证JSON，禁止明文存储密钥 */
    private String authCredential;

    /** 凭证过期时间 */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private Date expireTime;

    /** 连接启用标识：Y=开启连接，N=关闭连接，新建默认关闭 */
    private String enableFlag;

    /** 状态编码：00A=有效，00X=无效（软删除） */
    private String statusCd;

    /** 凭证最后同步刷新时间 */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private Date lastSyncTime;

    /** 创建人标识 */
    private String createBy;

    /** 创建时间，新增自动填充 */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private Date createTime;

    /** 更新时间，新增不赋值为NULL，更新时手动填充 */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private Date updateTime;
}
