package com.iwhalecloud.byai.manager.entity.position;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.iwhalecloud.byai.common.annotation.Add;
import com.iwhalecloud.byai.common.annotation.Mod;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@TableName("po_position_external")
public class PositionExternal {

    /**
     * 职位组织外部系统ID
     */
    @TableId(value = "position_external_id", type = IdType.INPUT)
    @NotNull(groups = Mod.class, message = "{positionexternal.positionexternalid.notnull}")
    private Long positionExternalId;

    /**
     * 统一标识
     */
    private String unionId;

    /**
     * 职位名称
     */
    @Size(max = 255, message = "{positionexternal.positionname.size}")
    private String positionName;

    /**
     * 职位描述
     */
    @Size(max = 255, message = "{positionexternal.positiondesc.size}")
    private String positionDesc;

    /**
     * 来源类型
     */
    private Integer sourceType;

    /**
     * 职位ID
     */
    @NotNull(groups = {
        Add.class, Mod.class
    }, message = "{positionexternal.positionid.notnull}")
    private Long positionId;
}