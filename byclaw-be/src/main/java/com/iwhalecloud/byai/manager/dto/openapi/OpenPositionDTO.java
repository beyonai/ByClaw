package com.iwhalecloud.byai.manager.dto.openapi;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.iwhalecloud.byai.common.annotation.Add;
import com.iwhalecloud.byai.common.annotation.Mod;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-05-30 14:47:35
 * @description TODO
 */

@Getter
@Setter
public class OpenPositionDTO {

    /**
     * 岗位编码
     */
    @TableId(value = "position_id", type = IdType.INPUT)
    @NotNull(groups = Mod.class, message = "{openpositiondto.positionid.notnull}")
    private Long positionId;

    /**
     * 岗位名称
     */
    @NotEmpty(groups = {
        Add.class, Mod.class
    }, message = "{openpositiondto.name.notempty}")
    @Size(groups = {
        Add.class, Mod.class
    }, max = 50, message = "{openpositiondto.name.size}")
    private String positionName;

    /**
     * 岗位描述
     */
    @Size(groups = {
        Add.class, Mod.class
    }, max = 500, message = "{openpositiondto.desc.size}")
    private String positionDesc;

    /**
     * 是否生成新的主键映射外系统数�?
     */
    private boolean newPrimaryKey;
}
