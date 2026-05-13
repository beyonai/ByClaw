package com.iwhalecloud.byai.manager.qo.auth;

import com.iwhalecloud.byai.manager.dto.auth.AuthDTO;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import lombok.Getter;
import lombok.Setter;

/**
 * 资源成员设置入参
 */
@Getter
@Setter
public class ResourceMemberSettingQo {

    /**
     * 资源ID
     */
    @NotNull(message = "resourceId不能为空")
    private Long resourceId;

    /**
     * 组织ID，用于组织管理员权限校验
     */
    private Long orgId;

    /**
     * 红名单
     */
    private List<AuthDTO> redList;

    /**
     * 黑名单
     */
    private List<AuthDTO> blackList;
}
