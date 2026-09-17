package com.iwhalecloud.byai.manager.dto.users;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/** Narrow request boundary: callers may select an account and nothing else. */
@Getter
@Setter
public class MailConnectionCheckRequestDTO {

    @NotNull(message = "邮箱账号ID不能为空")
    private Long accountId;

    @JsonAnySetter
    public void rejectUnknownField(String ignoredName, Object ignoredValue) {
        throw new IllegalArgumentException("Unsupported mail connection check field");
    }
}
