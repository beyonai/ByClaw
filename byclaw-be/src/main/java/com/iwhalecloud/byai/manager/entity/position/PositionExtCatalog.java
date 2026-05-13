package com.iwhalecloud.byai.manager.entity.position;

import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.io.Serial;
import java.io.Serializable;
import java.util.Date;

/**
 * 领域和数字岗位关系表实体
 */
@Getter
@Setter
@TableName("po_position_ext_catalog")
public class PositionExtCatalog implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    /**
     * 数字岗位ID
     */
    private Long positionId;

    /**
     * 绑定的领域ID
     */
    private Long catalogId;

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

