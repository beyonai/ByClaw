package com.iwhalecloud.byai.manager.dto.organization;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-04-25 11:24:08
 * @description TODO
 */

@Getter
@Setter
public class UserOrOrgDTO {

    public static final String USER = "USER";

    public static final String ORG = "ORG";

    @NotNull(message = "{userororgdto.targetid.notnull}")
    private Long objectId;

    /**
     * 类型，USER:用户 ORG:组织
     */

    @Pattern(regexp = "^(USER|ORG)$", message = "{userororgdto.type.pattern}")
    private String objectType;

}
