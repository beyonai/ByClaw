package com.iwhalecloud.byai.manager.dto.resource;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * 发布渠道DTO
 */
@Getter
@Setter
public class PublishChannel {

    /**
     * 目录ID
     */
    @NotNull(message = "{publishchannel.catalogid.notnull}")
    private Long catalogId;

    /**
     * 组织ID
     */
    @NotNull(message = "{publishchannel.manorgid.notnull}")
    private Long manOrgId;

    /**
     * 管理员用户ID
     */
    @NotNull(message = "{publishchannel.manuserid.notnull}")
    private String manUserId;

    /**
     * 备注
     */
    private String remark;

}
