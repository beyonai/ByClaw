package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectMemberListDto;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectMember;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectMemberMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Date;
import java.util.List;

/**
 * 项目成员领域服务。
 * <p>
 * 负责项目成员的新增、查询、移除，以及成员与数字员工的绑定。
 */
@Slf4j
@Service
public class ProjectMemberService {

    @Autowired
    private ProjectMemberMapper memberMapper;

    @Autowired
    private SequenceService sequenceService;

    /**
     * 向指定项目添加成员。
     * <p>
     * role 为空时默认写入 {@code member}。
     *
     * @param projectId 项目ID
     * @param userId 用户ID
     * @param role 成员角色（如 owner / member），可空
     * @return 已落库的成员记录
     */
    public ProjectMember addMember(Long projectId, Long userId, String role) {
        ProjectMember member = new ProjectMember();
        member.setMemberId(sequenceService.nextVal());
        member.setProjectId(projectId);
        member.setUserId(userId);
        member.setRole(role != null ? role : "member");
        member.setCreateTime(new Date());
        memberMapper.insert(member);
        return member;
    }

    /**
     * 按项目ID查询成员列表，按加入时间升序。
     *
     * @param projectId 项目ID
     * @return 项目成员列表；无成员时返回空列表
     */
    public List<ProjectMember> listByProjectId(Long projectId) {
        LambdaQueryWrapper<ProjectMember> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ProjectMember::getProjectId, projectId).orderByAsc(ProjectMember::getCreateTime);
        return memberMapper.selectList(wrapper);
    }

    /**
     * 按项目ID联查成员列表，补充用户工号/名称及绑定数字员工名称。
     *
     * @param projectId 项目ID
     * @param userName 用户名
     * @return 成员列表 DTO；无成员时返回空列表
     */
    public List<ProjectMemberListDto> listProjectMembers(Long projectId, String userName) {
        return memberMapper.listProjectMembers(projectId, userName);
    }

    /**
     * 按成员记录ID物理删除成员。
     *
     * @param memberId 成员记录ID
     */
    public void removeMember(Long memberId) {
        memberMapper.deleteById(memberId);
    }

    /**
     * 按项目ID与角色批量删除成员。
     *
     * @param projectId 项目ID
     * @param role 成员角色（如 owner / member）
     */
    public void removeMember(Long projectId, String role) {
        LambdaQueryWrapper<ProjectMember> deleteWrapper = new LambdaQueryWrapper<>();
        deleteWrapper.eq(ProjectMember::getProjectId, projectId);
        deleteWrapper.eq(ProjectMember::getRole, role);
        memberMapper.delete(deleteWrapper);
    }

    /**
     * 按成员记录ID查询成员。
     *
     * @param memberId 成员记录ID
     * @return 成员记录；不存在时返回 null
     */
    public ProjectMember getById(Long memberId) {
        return memberMapper.selectById(memberId);
    }

    /**
     * 判断用户是否已是指定项目的成员。
     *
     * @param projectId 项目ID
     * @param userId 用户ID
     * @return true 表示已是成员，false 表示不是
     */
    public boolean isMember(Long projectId, Long userId) {
        LambdaQueryWrapper<ProjectMember> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ProjectMember::getProjectId, projectId).eq(ProjectMember::getUserId, userId);
        return memberMapper.selectCount(wrapper) > 0;
    }

    /**
     * 按项目ID与用户ID查找成员记录。
     *
     * @param projectId 项目ID
     * @param userId 用户ID
     * @return 成员记录；不存在时返回 null
     */
    public ProjectMember findByProjectAndUser(Long projectId, Long userId) {
        LambdaQueryWrapper<ProjectMember> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ProjectMember::getProjectId, projectId).eq(ProjectMember::getUserId, userId);
        return memberMapper.selectOne(wrapper);
    }

    /**
     * 为成员绑定默认数字员工。
     *
     * @param memberId 成员记录ID
     * @param agentId 数字员工资源ID
     */
    public void bindAgent(Long memberId, Long agentId) {
        ProjectMember member = new ProjectMember();
        member.setMemberId(memberId);
        member.setAgentId(agentId);
        memberMapper.updateById(member);
    }
}
