package com.iwhalecloud.byai.manager.entity.mode;

import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

/**
 * 模式与数字员工关联表
 *
 * @author system
 */
@Getter
@Setter
@TableName("byai_mode")
public class ByaiMode {

    /**
     * 模式编码
     */
    private String modeCode;

    private String modeName;

    /**
     * 是否默认
     */
    private String isDefault;

    /**
     * 前端是否展示模式下的数字员工
     */
    private String showDigitalHuman;
}
