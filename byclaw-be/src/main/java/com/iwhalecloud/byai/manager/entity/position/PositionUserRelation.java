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
 * 数字岗位与管理员用户绑定关系
 */
@Getter
@Setter
@TableName("digital_position_user_relation")
public class PositionUserRelation implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    /**
     * 记录ID（主键）
     */
    @TableId(value = "dig_position_rel_id", type = IdType.INPUT)
    private Long digPositionRelId;

    /**
     * 数字岗位ID
     */
    private Long positionId;

    /**
     * 管理员用户ID
     */
    private Long userId;

    /**
     * 创建人
     */
    private String createBy;

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

