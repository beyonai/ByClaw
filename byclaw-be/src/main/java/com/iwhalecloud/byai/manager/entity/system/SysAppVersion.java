package com.iwhalecloud.byai.manager.entity.system;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * 应用版本表实体 对应表：sys_app_version
 * <p>
 * 说明：字段类型使用通用 Java 类型，兼容 MySQL / Oracle / PostgreSQL。
 * </p>
 */
@Getter
@Setter
@TableName("sys_app_version")
public class SysAppVersion {

    /**
     * 版本id
     */
    @TableId(value = "version_id", type = IdType.INPUT)
    @JsonSerialize(using = ToStringSerializer.class)
    private Long versionId;

    /**
     * 客户端设备类型；本期只处理桌面端，固定为 electron。
     * 后续若接入 iOS / Android / 微信小程序等端，再按端扩展取值。
     * 桌面端内部的多平台/多架构请用 platform/arch 区分，不要动本字段。
     */
    private String deviceType;

    /**
     * 当前版本
     */
    private String appVersion;

    /**
     * 当前版本存放位置
     */
    private String url;

    /**
     * 推荐升级策略
     */
    private String updateType;

    /**
     * 升级说明
     */
    private String updateMsg;

    /**
     * 发布时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date publishTime;

    /**
     * 是否强制更新 0正常 1强制更新
     */
    private String updateStatus;

    /**
     * 桌面端平台：windows/macos
     */
    private String platform;

    /**
     * x64/arm64/universal
     */
    private String arch;

    /**
     * stable/beta/dev
     */
    private String channel;

    /**
     * 安装包文件名
     */
    private String fileName;

    /**
     * 安装包字节数
     */
    private Long fileSize;

    /**
     * 安装包 SHA-256，64 位十六进制
     */
    private String sha256;

    /**
     * draft/published/offline
     */
    private String releaseStatus;

    /**
     * 创建人
     */
    private Long createBy;

    /**
     * 更新人
     */
    private Long updateBy;

    /**
     * 创建时间
     */
    private Date createTime;

    /**
     * 更新时间
     */
    private Date updateTime;
}
