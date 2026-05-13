package com.iwhalecloud.byai.manager.entity.message;

import java.io.Serializable;
import java.time.LocalDateTime;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Builder;
import lombok.Getter;
import lombok.Setter;

/**
 * 消息分享链接与消息关联实体
 * <p>
 * 对应数据库表：message_share_link_message
 * </p>
 * <p>
 * 一个分享链接（message_share_link）可关联多条消息，本表记录 link_id 与 message_id 的多对多关系。
 * </p>
 */
@Getter
@Setter
@Builder
@TableName("message_share_link_message")
public class MessageShareLinkMessage implements Serializable {

    private static final long serialVersionUID = 1L;

    /** 主键ID */
    private Long id;

    /** 分享链接ID（关联 message_share_link.link_id） */
    private Long linkId;

    /** 消息ID */
    private Long messageId;

    /** 创建时间 */
    private LocalDateTime createTime;

    /** 所属企业 */
    private Long comAcctId;
}
