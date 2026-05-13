package com.iwhalecloud.byai.manager.dto.organization;


import com.iwhalecloud.byai.common.annotation.Add;
import com.iwhalecloud.byai.common.annotation.Mod;
import com.iwhalecloud.byai.manager.validate.users.annotation.OrgIdValidator;
import com.iwhalecloud.byai.manager.validate.users.annotation.PositionIdValidator;
import com.iwhalecloud.byai.manager.validate.users.annotation.UserTypeValidator;
import com.iwhalecloud.byai.manager.validate.users.annotation.UserTypesValidator;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;
import java.util.List;

/**
 * @author he.duming
 * @date 2025-04-25 11:21:03
 * @description 新增用户DTO
 */
@Getter
@Setter
public class AddUserByOrgDTO {

    @NotNull(message = "{adduserbyorgdto.orgid.notnull}")
    @OrgIdValidator(message = "{adduserbyorgdto.orgid.valid}")
    private Long orgId;

    @NotEmpty(message = "{adduserbyorgdto.userlist.notempty}")
    private List<UserOrOrgDTO> userOrOrgVos;

    @NotNull(message = "{adduserbyorgdto.positionid.notnull}")
    @PositionIdValidator(message = "{adduserbyorgdto.positionid.valid}")
    private Long positionId;

    @UserTypeValidator(
        message = "{adduserbyorgdto.role.valid}")
    private String userType;

    @UserTypesValidator(groups = { Add.class, Mod.class }, message = "{adduserbyorgdto.role.valid}")
    private List<String> userTypes;

}
