package com.iwhalecloud.byai.manager.dto.datacloud;

import jakarta.validation.constraints.NotEmpty;
import lombok.Data;

import java.util.List;

/**
 * 脚本模板批量删除DTO
 * 
 * @author system
 * @date 2025-01-15
 */
@Data
public class DatacloudScriptTemplateBatchDeleteDTO {

    /**
     * 模板ID列表
     */
    @NotEmpty(message = "模板ID列表不能为空")
    private List<Long> templateIds;

}
