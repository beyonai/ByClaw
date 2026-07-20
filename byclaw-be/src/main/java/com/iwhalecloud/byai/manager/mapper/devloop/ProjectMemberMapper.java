package com.iwhalecloud.byai.manager.mapper.devloop;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectMemberListDto;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectMember;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface ProjectMemberMapper extends BaseMapper<ProjectMember> {

    /**
     * 按项目ID联查成员列表（含用户信息、数字员工名称）。
     *
     * @param projectId 项目ID
     * @return 成员列表 DTO
     */
    List<ProjectMemberListDto> listProjectMembers(@Param("projectId") Long projectId);
}
