package com.iwhalecloud.byai.manager.entity.session;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

/**
 * 会话扩展参数表实体 对应表：byai.byai_session_ext
 * <p>
 * 说明：用于保存会话的扩展键值信息。
 * </p>
 */
@Data
@TableName("byai_session_ext")
public class ByaiSessionExt {

    private static final long serialVersionUID = 1L;

    /**
     * 扩展主键
     */
    @TableId(value = "ext_id", type = IdType.INPUT)
    private Long extId;

    /**
     * 会话主键
     */
    private Long sessionId;

    /**
     * 扩展参数名称
     */
    private String extParamName;

    /**
     * 扩展参数编码
     */
    private String extParamCode;

    /**
     * 扩展参数值
     */
    private String extParamValue;
}
