package com.iwhalecloud.byai.manager.domain.session.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.state.domain.template.enums.DebugModeEnum;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * 会话主表领域服务 对应表：byai_session
 *
 * @author system
 */
@Service
public class ByaiSessionService {

    @Autowired
    private ByaiSessionMapper byaiSessionMapper;

    /**
     * 查找会话
     *
     * @param sessionId 会话标识
     * @return ByaiSession
     */
    public ByaiSession findById(Long sessionId) {
        return byaiSessionMapper.selectById(sessionId);
    }

    /**
     * 查询调试会话
     *
     * @param agentId 数据员工标识
     * @return ByaiSession
     */
    public ByaiSession findDebugSessionByAgentId(Long agentId) {
        LambdaQueryWrapper<ByaiSession> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(ByaiSession::getObjectType, "DigEmployee");
        queryWrapper.eq(ByaiSession::getCreatorId, CurrentUserHolder.getCurrentUserId());
        queryWrapper.eq(ByaiSession::getObjectId, agentId);
        queryWrapper.eq(ByaiSession::getIsDebug, DebugModeEnum.DEBUG_1.getNum());
        return byaiSessionMapper.selectOne(queryWrapper);
    }

}
