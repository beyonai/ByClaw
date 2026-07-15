package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectMember;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectMemberMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Date;
import java.util.List;

/** 项目成员领域服务 */
@Slf4j
@Service
public class ProjectMemberService {

    @Autowired
    private ProjectMemberMapper memberMapper;

    @Autowired
    private SequenceService sequenceService;

    /** 添加成员 */
    public ProjectMember addMember(Long projectId, String userId, String userCode, String userName, String role) {
        ProjectMember member = new ProjectMember();
        member.setMemberId(sequenceService.nextVal());
        member.setProjectId(projectId);
        member.setUserId(userId);
        member.setUserCode(userCode);
        member.setUserName(userName);
        member.setRole(role != null ? role : "member");
        member.setCreateTime(new Date());
        memberMapper.insert(member);
        return member;
    }

    /** 查询项目成员列表 */
    public List<ProjectMember> listByProjectId(Long projectId) {
        LambdaQueryWrapper<ProjectMember> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ProjectMember::getProjectId, projectId)
               .orderByAsc(ProjectMember::getCreateTime);
        return memberMapper.selectList(wrapper);
    }

    /** 移除成员 */
    public void removeMember(Long memberId) {
        memberMapper.deleteById(memberId);
    }

    /** 根据ID查询成员 */
    public ProjectMember getById(Long memberId) {
        return memberMapper.selectById(memberId);
    }

    /** 判断用户是否已是成员 */
    public boolean isMember(Long projectId, String userId) {
        LambdaQueryWrapper<ProjectMember> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ProjectMember::getProjectId, projectId)
               .eq(ProjectMember::getUserId, userId);
        return memberMapper.selectCount(wrapper) > 0;
    }

    /** 根据项目和用户查找成员 */
    public ProjectMember findByProjectAndUser(Long projectId, String userId) {
        LambdaQueryWrapper<ProjectMember> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ProjectMember::getProjectId, projectId)
               .eq(ProjectMember::getUserId, userId);
        return memberMapper.selectOne(wrapper);
    }

    /** 绑定数字员工 */
    public void bindAgent(Long memberId, Long agentId) {
        ProjectMember member = new ProjectMember();
        member.setMemberId(memberId);
        member.setAgentId(agentId);
        memberMapper.updateById(member);
    }
}
