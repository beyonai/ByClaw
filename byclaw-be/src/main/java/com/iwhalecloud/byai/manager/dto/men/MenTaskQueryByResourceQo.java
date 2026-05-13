package com.iwhalecloud.byai.manager.dto.men;

import com.iwhalecloud.byai.common.constants.men.MenTaskStatusEnum;
import com.iwhalecloud.byai.common.annotation.Query;
import com.iwhalecloud.byai.common.util.ListUtil;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Data;

import java.io.Serializable;
import java.util.Arrays;
import java.util.List;

/**
 * 根据资源ID查询待办任务请求对象
 */
@Data
public class MenTaskQueryByResourceQo implements Serializable {

    /** 来源系统编码 */
    @NotBlank(groups = {
        Query.class
    }, message = "{mentaskquerybyresourceqo.systemcode.notempty}")
    @Pattern(groups = {
        Query.class
    }, regexp = "^(BYAI|BOT|WHALE\\+|UIAGENT)$", message = "{mentaskquerybyresourceqo.systemcode.invalid}")
    private String systemCode;

    /** 资源ID */
    @NotBlank(groups = {
        Query.class
    }, message = "{mentaskquerybyresourceqo.resourceid.notempty}")
    @Size(groups = {
        Query.class
    }, max = 50, message = "{mentaskquerybyresourceqo.resourceid.maxlength}")
    private String resourceId;

    /** 任务状态列表（可选，不传则查询所有状态） */
    private List<String> statusCodes;

    /** 是否只查询活跃状态的任务（Submitted, Working, InputRequired, AuthRequired） */
    private Boolean onlyActive = false;

    /** 是否只查询已完成的任务（Completed） */
    private Boolean onlyCompleted = false;

    /** 是否只查询已取消的任务（Canceled, Failed, Rejected） */
    private Boolean onlyInactive = false;

    /**
     * 获取实际要查询的状态列表
     */
    public List<String> getActualStatusCodes() {
        if (ListUtil.isNotEmpty(statusCodes)) {
            return statusCodes;
        }

        if (Boolean.TRUE.equals(onlyActive)) {
            return getActiveStatusCodes();
        }

        if (Boolean.TRUE.equals(onlyCompleted)) {
            return getCompletedStatusCodes();
        }

        if (Boolean.TRUE.equals(onlyInactive)) {
            return getInactiveStatusCodes();
        }

        return null; // 查询所有状态
    }

    /**
     * 获取活跃状态代码列表
     */
    private List<String> getActiveStatusCodes() {
        return Arrays.asList(MenTaskStatusEnum.SUBMITTED.getCode(), MenTaskStatusEnum.WORKING.getCode(),
            MenTaskStatusEnum.INPUTREQUIRED.getCode(), MenTaskStatusEnum.AUTHREQUIRED.getCode());
    }

    /**
     * 获取已完成状态代码列表
     */
    private List<String> getCompletedStatusCodes() {
        return Arrays.asList(MenTaskStatusEnum.COMPLETED.getCode());
    }

    /**
     * 获取非活跃状态代码列表
     */
    private List<String> getInactiveStatusCodes() {
        return Arrays.asList(MenTaskStatusEnum.CANCELED.getCode(), MenTaskStatusEnum.FAILED.getCode(),
            MenTaskStatusEnum.REJECTED.getCode());
    }
}
