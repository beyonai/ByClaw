package com.iwhalecloud.byai.common.message.service;

import com.github.pagehelper.Page;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.github.pagehelper.PageHelper;
import com.iwhalecloud.byai.common.message.qo.MessageHotDelQo;
import com.iwhalecloud.byai.common.message.qo.MessageHotPageQo;
import com.iwhalecloud.byai.common.message.qo.MessageHotQo;
import com.iwhalecloud.byai.state.domain.message.qo.MessageQo;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.stream.Collectors;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * 消息热度 Service。
 *
 * @author he.duming
 * @since 2026-02-03ByaiMessageHotService
 */
@Slf4j
@Service
public class ByaiMessageHotService {

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private ByaiMessageMapper byaiMessageMapper;

    /**
     * 新增消息热度到 ES 索引，支持单个或批量
     *
     * @param byaiMessageHotDtos 消息热度
     */
    public boolean add(ByaiMessageHotDto... byaiMessageHotDtos) {

        List<ByaiMessage> messages = new ArrayList<>();
        for (ByaiMessageHotDto byaiMessageHotDto : byaiMessageHotDtos) {
            ByaiMessage byaiMessage = new ByaiMessage();
            BeanUtils.copyProperties(byaiMessageHotDto, byaiMessage);
            byaiMessage.setId(sequenceService.nextVal());
            byaiMessage.setCreateTime(new Date());
            messages.add(byaiMessage);
        }
        // mapper插入
        int rows = byaiMessageMapper.insertBatch(messages);
        if (rows != messages.size()) {
            log.error("add: 批量插入消息失败, expected={}, actual={}", messages.size(), rows);
            throw new BaseException(
                String.format("batch insert byai_message failed, expected=%d, actual=%d", messages.size(), rows));
        }
        return true;
    }

    /**
     * 按消息 ID 删除
     *
     * @param messageId 消息 ID
     */
    public void deleteById(Long messageId) {
        if (messageId == null) {
            return;
        }
        ByaiMessage existing = byaiMessageMapper.selectByMessageId(messageId);
        if (existing == null) {
            log.warn("deleteById: 消息不存在, messageId={}", messageId);
            return;
        }
        byaiMessageMapper.deleteByMessageId(messageId);
    }

    /**
     * 选择性更新消息热度（存在则更新，不存在则插入）
     *
     * @param byaiMessageHotDto 消息热度
     */
    public void updateSelective(ByaiMessageHotDto byaiMessageHotDto) {
        if (byaiMessageHotDto == null || byaiMessageHotDto.getMessageId() == null) {
            return;
        }
        ByaiMessage existing = byaiMessageMapper.selectByMessageId(byaiMessageHotDto.getMessageId());
        if (existing == null) {
            ByaiMessage byaiMessage = new ByaiMessage();
            BeanUtils.copyProperties(byaiMessageHotDto, byaiMessage);
            byaiMessage.setUpdateTime(new Date());
            log.info("updateSelective: 消息不存在, 执行插入, messageId={}", byaiMessageHotDto.getMessageId());
            int rows = byaiMessageMapper.insertBatch(List.of(byaiMessage));
            if (rows != 1) {
                log.error("updateSelective: 单条补插失败, messageId={}, actual={}", byaiMessageHotDto.getMessageId(), rows);
                throw new BaseException(String.format("insert byai_message failed, messageId=%d, actual=%d",
                    byaiMessageHotDto.getMessageId(), rows));
            }
        }
        else {
            byaiMessageMapper.updateByMessageId(byaiMessageHotDto);
        }
    }

    /**
     * 按消息 ID 查询
     *
     * @param messageId 消息 ID
     * @return 消息热度，未找到返回 null
     */
    public ByaiMessageHotDto findById(Long messageId) {
        if (messageId == null) {
            return null;
        }
        ByaiMessage byaiMessage = byaiMessageMapper.selectByMessageId(messageId);
        if (byaiMessage == null) {
            return null;
        }
        return convertToHot(byaiMessage);
    }

    /**
     * 分页查询消息
     *
     * @param byaiMessageQo 分页对象
     * @return SearchHits
     */
    public PageInfo<ByaiMessage> selectByPageQo(MessageHotPageQo byaiMessageQo) {
        Page<ByaiMessage> page = PageHelper.startPage(byaiMessageQo.getPageNum(), byaiMessageQo.getPageSize());
        byaiMessageMapper.selectByPageQo(byaiMessageQo);
        return PageHelperUtil.toPageInfo(page);
    }

    /**
     * 查询关联消息列表
     *
     * @param messageHotQo 查询对象
     * @return List<ByaiMessageHot>
     */
    public List<ByaiMessageHotDto> findByQo(MessageHotQo messageHotQo) {
        if (messageHotQo == null) {
            return new ArrayList<>();
        }
        List<ByaiMessage> records = byaiMessageMapper.selectByQo(messageHotQo);
        if (records == null || records.isEmpty()) {
            return new ArrayList<>();
        }
        return records.stream().map(this::convertToHot).collect(Collectors.toList());
    }

    /***
     * 根据查询条件删除消息
     *
     * @param messageHotDelQo 删除对象
     */
    public void deleteByQo(MessageHotDelQo messageHotDelQo) {
        if (messageHotDelQo == null) {
            return;
        }
        if (messageHotDelQo.getSessionId() == null && messageHotDelQo.getMessageId() == null) {
            log.warn("deleteByQo: 删除条件为空, 跳过执行");
            return;
        }
        byaiMessageMapper.deleteByQo(messageHotDelQo);
    }

    /**
     * 统计指定会话的消息总数
     *
     * @param sessionId 会话标识
     * @return 该会话的消息总数
     */
    public long countBySessionId(Long sessionId) {
        if (sessionId == null) {
            return 0L;
        }
        return byaiMessageMapper.countBySessionId(sessionId);
    }

    /**
     * 统计指定会话中 messageId 小于等于指定 messageId 的消息数量（用于计算消息位置，1-based）
     *
     * @param sessionId 会话标识
     * @param messageId 消息标识
     * @return 满足条件的消息数量
     */
    public long countPositionInSession(Long sessionId, Long messageId) {
        if (sessionId == null || messageId == null) {
            return 0L;
        }
        return byaiMessageMapper.countPositionInSession(sessionId, messageId);
    }

    /**
     * 根据 sessionId 查询最近 topK 条消息（按 createTime 降序）
     *
     * @param messageQo 包含 sessionId 和 topK
     * @return 消息列表
     */
    public List<ByaiMessageHotDto> getMessages(MessageQo messageQo) {
        MessageHotQo qo = new MessageHotQo();
        qo.setSessionId(messageQo.getSessionId());
        qo.setTopK(messageQo.getTopK());
        return findByQo(qo);
    }

    /**
     * ByaiMessage -> ByaiMessageHot 转换
     */
    private ByaiMessageHotDto convertToHot(ByaiMessage msg) {
        ByaiMessageHotDto hot = new ByaiMessageHotDto();
        BeanUtils.copyProperties(msg, hot);

        if (msg.getIsComplete() != null) {
            hot.setComplete(msg.getIsComplete());
        }
        return hot;
    }

}
