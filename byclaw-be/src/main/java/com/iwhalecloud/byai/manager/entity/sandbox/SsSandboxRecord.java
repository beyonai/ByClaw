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

    /** 沙箱服务类型，例如 openclaw。 */
    private String serviceType;

    /** 沙箱资源规格分层，例如 xs/s/m/l。 */
    private String profileKey;

    /** 创建或最近一次扩缩容后的资源 requests JSON。 */
    private String resourceRequests;

    /** 创建或最近一次扩缩容后的资源 limits JSON。 */
    private String resourceLimits;

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

    /** 最近一次动态扩缩容状态。 */
    private String resizeStatus;

    /** 最近一次动态扩缩容时间。 */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date lastResizeAt;

    /** 最近一次动态扩缩容原因。 */
    private String lastResizeReason;

    /** 最近一次动态扩缩容耗时（毫秒）。 */
    private Long lastResizeDurationMs;

    /** 最近一次动态扩缩容是否成功：1-成功，0-失败。 */
    private Integer lastResizeSuccess;

    /** 最近一次动态扩缩容来源规格。 */
    private String lastResizeFromProfile;

    /** 最近一次动态扩缩容目标规格。 */
    private String lastResizeToProfile;

    /** 最近一次动态扩缩容错误信息。 */
    private String lastResizeError;

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
