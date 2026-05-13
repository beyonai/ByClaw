package com.iwhalecloud.byai.manager.qo.organization;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;
import java.util.List;

/**
 * @author he.duming
 * @date 2025-04-26 20:36:41
 * @description TODO
 */
@Getter
@Setter
public class OrgManagerQo {

    @NotNull(message = "{orgmanagerqo.orgid.notnull}")
    private Long orgId;

    private List<String> userTypes;
}
