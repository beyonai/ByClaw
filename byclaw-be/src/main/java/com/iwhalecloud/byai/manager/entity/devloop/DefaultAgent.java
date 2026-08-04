package com.iwhalecloud.byai.manager.entity.devloop;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * 默认数字员工:架构/代码/测试三角色的兜底员工。
 * project_id=0 为全局默认行,>0 为该项目覆盖行;项目某角色为空则回退全局默认。
 */
@Getter
@Setter
@TableName("byai_default_agent")
public class DefaultAgent {

    @TableId(value = "id", type = IdType.INPUT)
    private Long id;

    /** 作用域:0 全局默认,>0 项目覆盖 byai_project.project_id */
    private Long projectId;

    private String architectAgentId;

    private String architectAgentName;

    private String coderAgentId;

    private String coderAgentName;

    private String testerAgentId;

    private String testerAgentName;

    private Long createBy;

    private Date createTime;

    private Long updateBy;

    private Date updateTime;

    private String deleteFlag;
}
