package com.iwhalecloud.byai.manager.entity.staticdata;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.iwhalecloud.byai.common.annotation.Add;
import com.iwhalecloud.byai.common.annotation.Mod;
import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@TableName("byai_system_config")
public class ByaiSystemConfig {

    /**
     * 参数ID
     */
    @TableId(value = "param_id", type = IdType.INPUT)
    private Long paramId;

    /**
     * 类型,text或者json
     */
    private String paramType;

    /**
     * 静态参数参数编码码
     */
    @NotBlank(groups = {
        Add.class, Mod.class
    }, message = "{dcsystemconfigdto.paramcode.notempty}")
    private String paramCode;

    /**
     * 参数名称
     */
    @NotBlank(groups = {
        Add.class, Mod.class
    }, message = "{byaisystemconfig.paramname.notempty}")
    private String paramName;

    /**
     * 参数英文名称
     */
    private String paramEnName;

    /***
     * 静态参数值
     */
    private String paramValue;

    /**
     * 静态参数描述
     */
    private String paramDesc;

}
