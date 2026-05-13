package com.iwhalecloud.byai.manager.mapper.message;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.common.message.qo.MessageHotDelQo;
import com.iwhalecloud.byai.common.message.qo.MessageHotPageQo;
import com.iwhalecloud.byai.common.message.qo.MessageHotQo;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * byai_message Mapper
 */
@Mapper
public interface ByaiMessageMapper extends BaseMapper<ByaiMessage> {

    /**
     * 根据会话ID查询消息列表
     *
     * @param sessionId 会话ID
     * @return 消息列表
     */
    List<ByaiMessage> selectBySessionId(@Param("sessionId") Long sessionId);

    /**
     * 根据任务ID查询消息列表
     *
     * @param taskId 任务ID
     * @return 消息列表
     */
    List<ByaiMessage> selectByTaskId(@Param("taskId") Long taskId);

    /**
     * 根据 messageId 查询单条记录
     *
     * @param messageId 消息ID
     * @return 记录（可能为 null）
     */
    ByaiMessage selectByMessageId(@Param("messageId") Long messageId);

    /**
     * 根据会话ID删除记录
     *
     * @param sessionId 会话ID
     * @return 删除行数
     */
    int deleteBySessionId(@Param("sessionId") Long sessionId);

    /**
     * 批量插入消息（用于消息热度写入 byai.byai_message）
     *
     * <p>注意：表中主键字段是 {@code id}，但 {@link ByaiMessageHotDto} 里没有 {@code id}；
     * 实现里默认使用 {@code messageId} 作为 {@code id} 写入。</p>
     *
     * @param list 消息列表
     * @return 插入行数
     */
    int insertBatch(@Param("list") List<ByaiMessage> list);

    /**
     * 根据 messageId 删除记录
     *
     * @param messageId 消息ID
     * @return 删除行数
     */
    int deleteByMessageId(@Param("messageId") Long messageId);

    /**
     * 根据 messageId 选择性更新非空字段
     *
     * @param item 消息热度对象
     * @return 更新行数
     */
    int updateByMessageId(@Param("item") ByaiMessageHotDto item);

    /**
     * 分页查询消息列表
     *
     * @param qo 分页查询条件
     * @return 消息列表
     */
    List<ByaiMessage> selectByPageQo(@Param("qo") MessageHotPageQo qo);

    /**
     * 根据查询条件查询消息列表（替代原 ES 查询）
     *
     * @param qo 查询条件
     * @return 消息列表
     */
    List<ByaiMessage> selectByQo(@Param("qo") MessageHotQo qo);


    /**
     * 根据查询条件删除消息
     *
     * @param qo 删除条件
     * @return 删除行数
     */
    int deleteByQo(@Param("qo") MessageHotDelQo qo);

    /**
     * 统计指定会话的消息总数
     *
     * @param sessionId 会话ID
     * @return 消息总数
     */
    Long countBySessionId(@Param("sessionId") Long sessionId);

    /**
     * 统计指定会话中 message_id <= 给定值的消息数量
     *
     * @param sessionId 会话ID
     * @param messageId 消息ID
     * @return 消息数量
     */
    Long countPositionInSession(@Param("sessionId") Long sessionId, @Param("messageId") Long messageId);
}

