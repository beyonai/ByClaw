package com.iwhalecloud.byai.manager.entity.resource;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import java.io.Serializable;
import java.time.LocalDateTime;
import lombok.Data;

/**
 * 技能资源扩展表实体类
 */
@Data
@TableName("ss_res_ext_skill")
public class SsResExtSkill implements Serializable {

    private static final long serialVersionUID = 1L;

    /**
     * 资源ID，关联 ss_resource.resource_id
     */
    @TableId
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    /**
     * 技能类型：hub=技能管理上传，inner=系统内置
     */
    private String skillType;

    /**
     * 技能来源类型
     */
    private String sourceType;

    /**
     * 技能版本号，初始 v0.1
     */
    private String version;

    /**
     * 技能 zip 在 MinIO/对象存储中的内部路径(object key)，非外部下载 URL
     */
    private String skillUrl;

    /**
     * 技能压缩包格式，当前固定为 zip
     */
    private String skillPackageFormat;

    /**
     * 技能压缩包上传时的原始文件名
     */
    private String skillOriginalFilename;

    /**
     * 技能压缩包大小，单位字节
     */
    private Long skillPackageSize;

    /**
     * 技能压缩包内容哈希
     */
    private String skillPackageHash;

    /**
     * 技能资源 JSON 内容
     */
    private String targetContent;

    /**
     * 同步状态：PENDING/SUCCESS/FAILED
     */
    private String syncStatus;

    /**
     * 最近一次同步失败原因
     */
    private String syncError;

    /**
     * 最近一次同步时间
     */
    private LocalDateTime lastSyncTime;
}
