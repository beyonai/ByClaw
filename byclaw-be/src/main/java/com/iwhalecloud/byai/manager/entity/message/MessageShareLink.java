package com.iwhalecloud.byai.manager.entity.message;

import java.time.LocalDateTime;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import lombok.experimental.SuperBuilder;

/**
 * 消息分享链接实体
 * <p>
 * 对应数据库表：message_share_link
 * </p>
 * <p>
 * 说明：
 * </p>
 * <ul>
 * <li>仅保存分享链接元数据，不包含具体消息内容。</li>
 * <li>具体关联的消息通过 message_share_link_message 表维护。</li>
 * </ul>
 */
@Getter
@Setter
@NoArgsConstructor
@SuperBuilder
@TableName("message_share_link")
public class MessageShareLink {

    /**
     * 主键ID
     */
    private Long linkId;

    /**
     * 分享链接标题
     */
    private String title;

    /**
     * 分享链接唯一标识（UUID+Base64URL）
     */
    private String linkToken;

    /**
     * 创建人ID
     */
    private Long creatorId;

    /**
     * 链接状态：ACTIVE-有效，EXPIRED-已过期，REVOKED-已撤销
     */
    private String status;

    /**
     * 访问权限类型：PUBLIC-免登录，AUTHENTICATED-需登录
     */
    private String accessPermission;

    /**
     * 链接有效期截止时间
     */
    private LocalDateTime expireTime;

    /**
     * 最大访问次数，NULL 表示无限制
     */
    private Long maxAccessCount;

    /**
     * 当前已访问次数
     */
    private Long currentAccessCount;

    /**
     * 最近一次访问时间
     */
    private LocalDateTime lastAccessTime;

    /**
     * 创建时间
     */
    private LocalDateTime createTime;

    /**
     * 更新时间
     */
    private LocalDateTime updateTime;

    /**
     * 所属企业
     */
    private Long comAcctId;
}
