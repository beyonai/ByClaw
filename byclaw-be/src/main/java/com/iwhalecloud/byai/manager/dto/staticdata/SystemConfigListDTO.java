package com.iwhalecloud.byai.manager.dto.staticdata;

import com.iwhalecloud.byai.manager.entity.staticdata.ByaiSystemConfigList;
import com.iwhalecloud.byai.common.annotation.Add;
import com.iwhalecloud.byai.common.annotation.Mod;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * @author he.duming
 * @date 2026-01-08 19:21:22
 * @description TODO
 */
@Getter
@Setter
public class SystemConfigListDTO {

    /**
     * 分组编码
     */
    @NotBlank(groups = {
        Add.class, Mod.class
    }, message = "{system.config.list.paramgroupcode.notblank}")
    private String paramGroupCode;

    /**
     * 分组名称
     */
    @NotBlank(groups = {
        Add.class, Mod.class
    }, message = "{system.config.list.paramgroupname.notblank}")
    private String paramGroupName;

    /**
     * 系统配置列表
     */
    @NotEmpty(groups = {
        Add.class, Mod.class
    }, message = "{system.config.list.byaisystemconfiglists.notempty}")
    private List<ByaiSystemConfigList> byaiSystemConfigLists;

}
