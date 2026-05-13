package com.iwhalecloud.byai.manager.entity.position;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.io.Serial;
import java.io.Serializable;
import java.util.Date;

/**
 * 数字岗位与数字员工绑定关系
 */
@Getter
@Setter
@TableName("ss_res_position_relation")
public class ResourcePositionRelation implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    /**
     * 记录ID（主键）
     */
    @TableId(value = "resource_position_rel_id", type = IdType.INPUT)
    private Long resourcePositionRelId;

    /**
     * 数字岗位ID
     */
    private Long positionId;

    /**
     * 数字员工ID
     */
    private Long resourceId;

    /**
     * 上岗状态 0:下岗 1:上岗 2:申请上岗 3:拒绝上岗
     */
    private Integer status;

    /**
     * 创建人/申请人
     */
    private String createBy;

    /**
     * 审批管理员
     */
    private String approver;

    /**
     * 上岗时间
     */
    private Date onJobTime;

    /**
     * 创建时间
     */
    private Date createTime;

    /**
     * 更新人
     */
    private String updateBy;

    /**
     * 更新时间
     */
    private Date updateTime;
}

