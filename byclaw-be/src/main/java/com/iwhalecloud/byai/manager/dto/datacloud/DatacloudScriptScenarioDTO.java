package com.iwhalecloud.byai.manager.dto.datacloud;

import com.iwhalecloud.byai.manager.entity.datacloud.DatacloudScriptScenario;
import lombok.Data;

/**
 * 脚本场景管理DTO
 * 
 * @author system
 * @date 2025-01-15
 */
@Data
public class DatacloudScriptScenarioDTO extends DatacloudScriptScenario {

   private String loginTypeName;

    /**
     * 子场景数量
     */
    private Integer childCount;

    /**
     * 关联脚本数量
     */
    private Integer scriptCount;
}
