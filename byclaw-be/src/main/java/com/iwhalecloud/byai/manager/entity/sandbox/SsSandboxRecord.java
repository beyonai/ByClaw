package com.iwhalecloud.byai.manager.entity.sandbox;

import com.alibaba.fastjson.annotation.JSONField;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;
import java.util.Date;

/**
 * 沙箱记录实体类 记录用户沙箱环境的创建、状态和访问信息
 */

@Setter
@Getter
@TableName("ss_sandbox_record")
public class SsSandboxRecord {

    /** 主键ID */
    @TableId(value = "id", type = IdType.INPUT)
    private Long id;

    /** 资源ID */
    private Long resourceId;

    /** 用户编码 */
    private String userCode;

    /** 沙箱类型 */
    private String sandboxType;

    /** 沙箱访问端点地址 */
    private String endpoint;

    /** Runtime returned sandbox id. */
    private String sandboxId;

    /** Gateway token bound to the sandbox instance. */
    private String gatewayToken;

    /** 会话ID */
    private String chatId;

    /** 沙箱状态：RUNNING-运行中，RELEASED-已释放 */
    private String status;

    /** 是否自动释放 1:自动释放 0:特权用户（长期沙箱） */
    private Integer autoRelease;

    /** Lifecycle release policy. */
    private String leasePolicy;

    /** Remote automatic expiration timeout in seconds. */
    private Integer timeoutSeconds;

    /** Remote expiration time when leasePolicy=REMOTE_AUTO_EXPIRE. */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date remoteExpiresAt;

    /** Last successful remote renewal time. */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date lastRenewAt;

    /** Next time this sandbox should be considered for remote renewal. */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date nextRenewAt;

    /** 最近一次访问时间 */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date lastAccessTime;

    /** Release completion time. */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date releaseTime;

    /** Release reason. */
    private String releaseReason;

    /** Business lifecycle version. */
    private Integer version;

    /** Optimistic lock version for concurrent DB updates. */
    private Integer lockVersion;

    /** 创建时间 */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date createTime;

    /** 更新时间 */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date updateTime;
}
