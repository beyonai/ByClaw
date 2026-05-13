package com.iwhalecloud.byai.manager.entity.position;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.iwhalecloud.byai.common.annotation.Add;
import com.iwhalecloud.byai.common.annotation.Mod;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@TableName("po_position")
public class Position {

    /**
     * 岗位编码
     */
    @TableId(value = "position_id", type = IdType.INPUT)
    @NotNull(groups = Mod.class, message = "{position.positionid.notnull}")
    private Long positionId;

    /**
     * 岗位名称
     */
    @NotEmpty(groups = {
        Add.class, Mod.class
    }, message = "{position.positionname.notempty}")
    @Size(groups = {
        Add.class, Mod.class
    }, max = 50, message = "{position.positionname.size}")
    @Pattern(groups = {
        Add.class, Mod.class
    }, regexp = "^[a-zA-Z0-9\\p{IsHan}]+$", message = "{position.positionname.validate}")
    private String positionName;

    /**
     * 岗位描述
     */
    @Size(groups = {
        Add.class, Mod.class
    }, max = 500, message = "{position.positiondesc.size}")
    private String positionDesc;

    /**
     * 是否为数字岗位 0 - 否 1 - 是
     */
    private Integer isDigitalPosition = 0;

}
