package com.iwhalecloud.byai.manager.domain.resource.service;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.Date;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.superassist.SuasSuperassistSubAgent;
import com.iwhalecloud.byai.manager.mapper.superassist.SuasSuperassistSubAgentMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;

/**
 * 超级助手子智能体关联服务
 * 处理授权订阅相关的业务逻辑
 *
 * @author AI Generated
 * @date 2025-01-20
 */
@Service
public class SuperassistSubAgentService {

    private static final Logger logger = LoggerFactory.getLogger(SuperassistSubAgentService.class);


    private static final String STATUS_ACTIVE = "00A";
    private static final Integer SUBSCRIBED = 1;
    private static final Integer UNSUBSCRIBED = 0;


    @Autowired
    private SuasSuperassistSubAgentMapper suasSuperassistSubAgentMapper;
    @Autowired
    private SequenceService SequenceService;


    /**
     * 处理订阅逻辑
     * 只有在授权订阅明细表中存在有效记录的情况下，用户才能进行订阅操作
     *
     * @param userId    用户ID
     * @param agentId   智能体ID
     * @param agentType 智能体类型
     */
    public void handleSubscription(Long userId, Long agentId, String agentType) {
        logger.info("开始处理用户订阅，用户ID: {}, 智能体ID: {}, 智能体类型 {}",
                userId, agentId, agentType);

        try {
            // 检查是否存在授权记录
            SuasSuperassistSubAgent record = findExistingRecord(userId, agentId);

            if (record == null) {
                //如果不存在则插入
                record = new SuasSuperassistSubAgent();
                record.setSuperassistSubAgentId(SequenceService.nextVal());
                record.setSuperassistId(userId);
                record.setAgentId(agentId);
                record.setAgentType(agentType);
                record.setIsSub(SUBSCRIBED);
                record.setSubTime(new Date());
                record.setCreateBy(CurrentUserHolder.getCurrentUserId());
                record.setCreateTime(new Date());
                record.setUpdateBy(CurrentUserHolder.getCurrentUserId());
                record.setUpdateDate(new Date());
                record.setStatusCd(STATUS_ACTIVE);
                suasSuperassistSubAgentMapper.insert(record);
            }

            logger.debug("开始更新订阅状态，用户ID: {}, 资源ID: {}", userId, agentId);

            // 更新订阅状态
            record.setIsSub(SUBSCRIBED);
            record.setSubTime(new Date());
            record.setUpdateBy(CurrentUserHolder.getCurrentUserId());
            record.setUpdateDate(new Date());

            suasSuperassistSubAgentMapper.updateById(record);


            logger.info("用户订阅处理完成，用户ID: {}, 智能体ID: {}", userId, agentId);
        } catch (Exception e) {
            logger.error("处理用户订阅失败，用户ID: {}, 智能体ID: {}, 错误: {}",
                    userId, agentId, e.getMessage());
            throw e;
        }
    }


    /**
     * 处理直接取消订阅逻辑（通过AuthApplicationService调用）
     * 当权限被直接撤销时，同步更新授权订阅明细表的状态
     *
     * @param userId     用户ID
     * @param resourceId 资源ID
     */
    public void handleDirectUnsubscribe(Long userId, Long resourceId) {
        logger.info("开始处理直接取消订阅，用户ID: {}, 资源ID: {}", userId, resourceId);

        try {
            // 查找现有记录
            SuasSuperassistSubAgent record = findExistingRecord(userId, resourceId);

            if (record != null) {
                // 如果存在记录，将状态设置为无效
                record.setIsSub(UNSUBSCRIBED); // 同时取消订阅
                record.setSubTime(new Date());
                record.setUpdateBy(CurrentUserHolder.getCurrentUserId());
                record.setUpdateDate(new Date());

                suasSuperassistSubAgentMapper.updateById(record);


                logger.info("直接取消订阅处理完成，用户ID: {}, 资源ID: {}", userId, resourceId);
            } else {
                logger.debug("直接取消订阅时未找到相关记录，用户ID: {}, 资源ID: {}", userId, resourceId);
            }
        } catch (Exception e) {
            logger.error("处理直接取消订阅失败，用户ID: {}, 资源ID: {}, 错误: {}",
                    userId, resourceId, e.getMessage());
            throw e;
        }
    }


    /**
     * 查找现有记录
     * 支持精确匹配查找，根据用户ID和资源ID进行唯一匹配
     */
    private SuasSuperassistSubAgent findExistingRecord(Long userId, Long agentId) {
        if (userId == null || agentId == null) {
            logger.warn("查找记录时用户ID或资源ID为空，用户ID: " + userId + ", 资源ID: " + agentId);
            return null;
        }

        LambdaQueryWrapper<SuasSuperassistSubAgent> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(SuasSuperassistSubAgent::getSuperassistId, userId)
                .eq(SuasSuperassistSubAgent::getAgentId, agentId);

        // 使用 selectOne 确保唯一性，如果有多条记录会抛出异常
        try {
            SuasSuperassistSubAgent record = suasSuperassistSubAgentMapper.selectOne(wrapper);
            if (record != null) {
                logger.debug("找到匹配的授权记录，用户ID: {}, 资源ID: {}, 记录ID: {}",
                        userId, agentId, record.getSuperassistSubAgentId());
            }
            return record;
        } catch (Exception e) {
            logger.error("查找授权记录时发生异常，用户ID: " + userId + ", 资源ID: " + agentId + ", 错误: " + e.getMessage());
            return null;
        }
    }


}
