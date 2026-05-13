package com.iwhalecloud.byai.state.domain.session.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.github.pagehelper.Page;
import com.github.pagehelper.PageHelper;
import com.iwhalecloud.byai.manager.qo.session.SessionByAgentQo;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMemberMapper;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.util.ListUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import java.util.List;
import java.util.Map;

/**
 * @author he.duming
 * @date 2026-02-14 10:40:44
 * @description TODO
 */
@Service
public class SessionMemberService {

    private static Logger logger = LoggerFactory.getLogger(SessionMemberService.class);

    @Autowired
    private ByaiSessionMemberMapper byaiSessionMemberMapper;

    /**
     * 保存会话成员
     *
     * @param byaiSessionMember 会话信息
     */
    public int save(ByaiSessionMember byaiSessionMember) {
        return byaiSessionMemberMapper.insert(byaiSessionMember);
    }

    public int batchSave(List<ByaiSessionMember> newMembers) {
        int i = 0;
        for (ByaiSessionMember byaiSessionMember : newMembers) {
            i = i + this.save(byaiSessionMember);
        }
        return i;
    }

    /**
     * 创建会话
     *
     * @param sessionId 会话信息
     */
    public void deleteBySessionId(Long sessionId) {
        LambdaQueryWrapper<ByaiSessionMember> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(ByaiSessionMember::getSessionId, sessionId);
        byaiSessionMemberMapper.delete(queryWrapper);
    }

    public List<ByaiSessionMember> findSessionMembers(Long sessionId, String memObjType, Long memObjId) {
        LambdaQueryWrapper<ByaiSessionMember> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(ByaiSessionMember::getSessionId, sessionId);

        if (StringUtil.isNotEmpty(memObjType)) {
            queryWrapper.eq(ByaiSessionMember::getMemObjType, memObjType);
        }

        if (memObjId != null) {
            queryWrapper.eq(ByaiSessionMember::getMemObjId, memObjId);
        }

        return byaiSessionMemberMapper.selectList(queryWrapper);
    }

    public void appendSessionMembers(Long sessionId, List<ByaiSessionMember> byaiSessionMembers) {

        for (ByaiSessionMember byaiSessionMember : byaiSessionMembers) {
            // 检查成员是否已存在
            Long memObjId = byaiSessionMember.getMemObjId();
            String memObjType = byaiSessionMember.getMemObjType();
            List<ByaiSessionMember> sessionMembers = this.findSessionMembers(sessionId, memObjType, memObjId);
            // 已经存在
            if (ListUtil.isNotEmpty(sessionMembers)) {
                continue;
            }

            this.save(byaiSessionMember);
        }
    }

    /**
     * 查询会话成员
     *
     * @param sessionId 会话标识
     * @param memObjType 成员对象类型
     * @param memObjId 成员对象ID
     * @return SessionMember
     */
    public ByaiSessionMember findSessionMember(Long sessionId, String memObjType, Long memObjId) {
        if (sessionId == null || StringUtil.isEmpty(memObjType) || memObjId == null) {
            logger.error("查询参数错误,请检查:sessionId={},memObjType={},memObjId={}", sessionId, memObjType, memObjId);
            return null;
        }
        return byaiSessionMemberMapper.findSessionMember(sessionId, memObjType, memObjId);
    }

    /**
     * 根据ID更新会话成员（只更新非空字段）
     *
     * @param sessionMember 会话成员信息
     */
    public void updateById(ByaiSessionMember sessionMember) {

        if (sessionMember == null) {
            logger.error("更新参数错误, sessionMember不能为空");
            return;
        }

        if (sessionMember.getByaiSessionMemberId() == null) {
            logger.error("更新参数错误, byaiSessionMemberId不能为空");
            return;
        }

        byaiSessionMemberMapper.updateSelective(sessionMember);
    }

    /**
     * 根据数字员工标识查询会话信息
     *
     * @param sessionByAgentQo 数字员工标识
     * @return List
     */
    public PageInfo<Map<String, Object>> querySessionByAgent(SessionByAgentQo sessionByAgentQo) {

        Integer pageNum = sessionByAgentQo.getPageNum();
        Integer pageSize = sessionByAgentQo.getPageSize();

        sessionByAgentQo.setUserId(CurrentUserHolder.getCurrentUserId());
        Page<Map<String, Object>> page = PageHelper.startPage(pageNum, pageSize);
        byaiSessionMemberMapper.querySessionByAgent(sessionByAgentQo);

        return PageHelperUtil.toPageInfo(page);
    }

}
