package com.iwhalecloud.byai.manager.mapper.message;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.message.MessageShareLink;
import org.apache.ibatis.annotations.Param;
import java.time.LocalDateTime;

/**
 * 消息分享链接表 Mapper
 * <p>
 * 负责 message_share_link 主表的持久化与查询。
 * </p>
 *
 * @author
 */
public interface MessageShareLinkMapper extends BaseMapper<MessageShareLink> {

    /**
     * 新增分享链接记录
     *
     * @param record 分享链接实体
     * @return 影响行数
     */
    int insert(MessageShareLink record);

    /**
     * 根据 link_token 查询分享链接
     *
     * @param linkToken 分享链接唯一标识
     * @return 分享链接实体，不存在则 null
     */
    MessageShareLink selectByLinkToken(@Param("linkToken") String linkToken);

    /**
     * 更新访问次数与最近访问时间
     *
     * @param linkId 分享链接ID
     * @param lastAccessTime 最近访问时间
     * @return 影响行数
     */
    int incrementAccessCountAndUpdateTime(@Param("linkId") Long linkId,
        @Param("lastAccessTime") LocalDateTime lastAccessTime);
}
