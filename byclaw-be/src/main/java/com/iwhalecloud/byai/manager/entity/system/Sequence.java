package com.iwhalecloud.byai.manager.entity.system;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.io.Serializable;

/**
 * 序列管理表实体类 对应表：byai_sequence
 * 
 * @author he.duming
 * @date 2025-07-30 11:29:50
 * @description 用于管理系统中各种序列的生成和配置
 */
@Getter
@Setter
@TableName("byai_sequence")
public class Sequence implements Serializable {

    private static final long serialVersionUID = 1L;

    /**
     * 序列标识 主键，自增长
     */
    @TableId(value = "sequence_id", type = IdType.INPUT)
    private Long sequenceId;

    /**
     * 序列名称 用于标识不同的序列，如：用户ID序列、订单号序列等
     */
    private String sequenceName;

    /**
     * 当前值 序列的当前值，用于生成下一个序列号
     */
    private Long currentValue;

    /**
     * 递增步长 每次获取序列号时的递增值，默认值
     */
    private Integer incrementBy;

    /**
     * 序列注释 对序列用途的说明和描述
     */
    private String seqComment;

}
