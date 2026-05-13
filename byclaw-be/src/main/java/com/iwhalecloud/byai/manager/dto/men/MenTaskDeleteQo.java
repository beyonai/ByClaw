package com.iwhalecloud.byai.manager.dto.men;

import com.iwhalecloud.byai.common.annotation.Del;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;
import java.util.List;

/**
 * 删除待办任务请求对象
 */
@Getter
@Setter
public class MenTaskDeleteQo {

    /**
     * 操作类型：delete
     */
    @NotBlank(groups = {
        Del.class
    }, message = "{mentaskdeleteqo.opertype.notempty}")
    @Pattern(groups = {
        Del.class
    }, regexp = "^(delete)$", message = "{mentaskdeleteqo.opertype.invalid}")
    private String operType = "delete";

    /**
     * 来源系统编码
     */
    @NotBlank(groups = {
        Del.class
    }, message = "{mentaskdeleteqo.systemcode.notempty}")
    @Pattern(groups = {
        Del.class
    }, regexp = "^(BYAI|BOT|WHALE\\+|UIAGENT)$", message = "{mentaskdeleteqo.systemcode.invalid}")
    private String systemCode;

    /**
     * 任务ID列表（BYAI系统使用）
     */
    private List<Long> taskIds;

    /**
     * 外部任务ID列表（外部系统使用）
     */
    private List<String> taskExtIds;

    /**
     * 资源ID列表（通过资源ID删除任务）
     */
    private List<Long> resourceIds;

    /**
     * 删除原因
     */
    @Size(max = 500, message = "{mentaskdeleteqo.deletereason.maxlength}")
    private String deleteReason;

    /**
     * 是否强制删除（忽略状态限制）
     */
    private Boolean forceDelete = false;

    /**
     * 删除类型：SINGLE-单个删除，BATCH-批量删除
     */
    @NotBlank(groups = {
        Del.class
    }, message = "{mentaskdeleteqo.deletetype.notempty}")
    @Pattern(groups = {
        Del.class
    }, regexp = "^(SINGLE|BATCH)$", message = "{mentaskdeleteqo.deletetype.invalid}")
    private String deleteType;

}
