package com.iwhalecloud.byai.manager.dto.users;

import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.common.annotation.Add;
import com.iwhalecloud.byai.common.annotation.Mod;
import com.iwhalecloud.byai.manager.validate.users.annotation.OrgIdValidator;
import com.iwhalecloud.byai.manager.validate.users.annotation.PositionIdValidator;
import com.iwhalecloud.byai.manager.validate.users.annotation.UserTypeValidator;
import com.iwhalecloud.byai.manager.validate.users.annotation.UserTypesValidator;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;
import java.util.List;

@Getter
@Setter
public class UsersDTO extends Users {

    /**
     * 用户关联组织
     */
    @NotNull(groups = { Add.class, Mod.class }, message = "{user.orgid.notnull}")
    @OrgIdValidator(groups = { Add.class, Mod.class }, message = "{user.orgid.valid}")
    private Long orgId;

    /**
     * 用户关联岗位
     */
    @NotNull(groups = { Add.class, Mod.class }, message = "{user.positionid.notnull}")
    @PositionIdValidator(groups = { Add.class, Mod.class }, message = "{user.positionid.valid}")
    private Long positionId;

    @UserTypeValidator(groups = { Add.class, Mod.class }, message = "{user.usertype.valid}")
    private String userType;

    @UserTypesValidator(groups = { Add.class, Mod.class }, message = "{user.usertype.valid}")
    private List<String> userTypes;

}
