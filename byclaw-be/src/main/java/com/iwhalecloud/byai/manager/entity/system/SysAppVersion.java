package com.iwhalecloud.byai.manager.entity.system;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.annotation.JsonFormat;
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
    private Long versionId;

    /**
     * ios/android
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
}
