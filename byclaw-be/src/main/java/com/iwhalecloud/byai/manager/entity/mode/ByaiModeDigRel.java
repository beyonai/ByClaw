package com.iwhalecloud.byai.manager.entity.mode;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Getter;
import lombok.Setter;

/**
 * 模式与数字员工关联表
 *
 * @author system
 */
@Getter
@Setter
@TableName("byai_mode_dig_rel")
public class ByaiModeDigRel {

    /**
     * 关联主键
     */
    @TableId(value = "rel_id", type = IdType.INPUT)
    @JsonSerialize(using = ToStringSerializer.class)
    private Long relId;

    /**
     * 模式编码
     */
    private String modeCode;

    /**
     * 资源ID（数字员工ID）
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;
}
