package com.iwhalecloud.byai.manager.entity.devloop;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/** 项目与知识库、数字员工、本体之间的多态绑定关系。 */
@Getter
@Setter
@TableName("byai_project_resource")
public class ProjectResource {
    @TableId(value = "id", type = IdType.INPUT)
    private Long id;
    private Long projectId;
    /** knowledge / digital_employee / ontology。 */
    private String resourceType;
    /** 统一按字符串保存，兼容不同资源模块的 ID 类型。 */
    private String resourceId;
    /** 绑定时的名称快照，便于资源被删除后仍能展示历史关系。 */
    private String resourceName;
    private Integer sortNo;
    private Long createBy;
    private Date createTime;
    private Long updateBy;
    private Date updateTime;
    private String deleteFlag;
}
