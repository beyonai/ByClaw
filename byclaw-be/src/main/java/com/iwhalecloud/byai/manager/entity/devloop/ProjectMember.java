package com.iwhalecloud.byai.manager.entity.devloop;

import java.util.Date;

import com.alibaba.fastjson.annotation.JSONField;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@TableName("byai_project_member")
public class ProjectMember {

    @TableId(value = "member_id", type = IdType.INPUT)
    private Long memberId;

    private Long projectId;

    private Long userId;

    private String role;

    private Long agentId;

    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date createTime;
}
