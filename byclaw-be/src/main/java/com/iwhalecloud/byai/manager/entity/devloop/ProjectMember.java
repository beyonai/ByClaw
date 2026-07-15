package com.iwhalecloud.byai.manager.entity.devloop;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

@Getter
@Setter
@TableName("byai_project_member")
public class ProjectMember {

    @TableId(value = "member_id", type = IdType.INPUT)
    private Long memberId;

    private Long projectId;

    private String userId;

    private String userCode;

    private String userName;

    private String role;

    private Long agentId;

    private Date createTime;
}
