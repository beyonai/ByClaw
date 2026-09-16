package com.iwhalecloud.byai.manager.entity.message;

import java.time.LocalDateTime;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import lombok.experimental.SuperBuilder;

/**
 * 分享链接实体（消息分享及群聊邀请）
 * <p>
 * 对应数据库表：message_share_link
 * </p>
 * <p>
 * 说明：
 * </p>
 * <ul>
 * <li>仅保存分享链接元数据，不包含具体消息内容。</li>
 * <li>消息分享通过 message_share_link_message 关联消息；群聊邀请直接以 linkId 关联 sessionId。</li>
 * </ul>
 */
@Getter
@Setter
@NoArgsConstructor
@SuperBuilder
@TableName("message_share_link")
public class MessageShareLink {

    /**
     * 类型内唯一 ID；消息分享独立生成，群聊邀请使用 sessionId
     */
    private Long linkId;

    /** MESSAGE（兼容历史 NULL）或 GROUP_INVITATION；群邀请的 linkId 为 sessionId。 */
    private String linkType;

    /**
     * 分享链接标题
     */
    private String title;

    /**
     * 原始 token：消息分享为 UUID+Base64URL，群聊邀请为 8 位字母数字
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
