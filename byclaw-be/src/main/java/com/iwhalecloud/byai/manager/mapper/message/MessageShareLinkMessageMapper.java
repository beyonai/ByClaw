package com.iwhalecloud.byai.manager.mapper.message;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.message.MessageShareLinkMessage;
import org.apache.ibatis.annotations.Param;
import java.util.List;

/**
 * 消息分享链接与消息关联表 Mapper
 * <p>
 * 负责 message_share_link_message 表的持久化操作。
 * </p>
 */
public interface MessageShareLinkMessageMapper extends BaseMapper<MessageShareLinkMessage> {

    /**
     * 新增一条分享链接-消息关联记录
     *
     * @param record 关联实体
     * @return 影响行数
     */
    int insert(MessageShareLinkMessage record);

    /**
     * 根据分享链接ID查询关联的消息ID列表
     *
     * @param linkId 分享链接ID
     * @return 消息ID列表
     */
    List<Long> selectMessageIdsByLinkId(@Param("linkId") Long linkId);

    /**
     * 批量插入分享链接-消息关联记录
     *
     * @param records 关联实体列表
     * @return 影响行数
     */
    int insertBatch(@Param("records") List<MessageShareLinkMessage> records);
}
