package com.iwhalecloud.byai.manager.dto.openapi;

import com.iwhalecloud.byai.common.annotation.Add;
import com.iwhalecloud.byai.common.annotation.Mod;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;

@Getter
@Setter
public class OpenUserDTO {

    @NotNull(groups = Mod.class, message = "{openuserdto.userid.notnull}")
    private Long userId;

    @Pattern(groups = {
        Add.class, Mod.class
    }, regexp = "^[a-zA-Z0-9]{3,50}$", message = "{openuserdto.usercode.pattern}")
    private String userCode;

    @Size(groups = {
        Add.class, Mod.class
    }, min = 2, max = 50, message = "{openuserdto.username.size}")
    private String userName;

    @Email(groups = {
        Add.class, Mod.class
    }, message = "{openuserdto.email.email}")
    private String email;

    private String phone;

    private String userNumber;

    private boolean newPrimaryKey;

    /**
     * 驻地ID
     */
    private Long stationId;

    private Integer registerType;

    private String pwd;

    private List<OpenUserOrgDTO> userOrgs = new ArrayList<>(10);

}
