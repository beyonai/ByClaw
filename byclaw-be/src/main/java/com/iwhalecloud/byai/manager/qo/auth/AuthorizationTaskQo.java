package com.iwhalecloud.byai.manager.qo.auth;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import lombok.Data;

@Data
public class AuthorizationTaskQo {
    @NotNull @Pattern(regexp = "[a-zA-Z0-9_-]{8,64}") private String requestId;
    @NotNull @Pattern(regexp = "USE|MANAGE") private String operation;
    @Valid @NotNull private ResourceMemberSettingQo setting;
}
