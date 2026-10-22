package com.iwhalecloud.byai.manager.dto.users;

import com.iwhalecloud.byai.common.i18n.I18nUtil;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/** Narrow request boundary: callers may select an account and nothing else. */
@Getter
@Setter
public class MailConnectionCheckRequestDTO {

    @NotNull(message = "{mail.account.idRequired}")
    private Long accountId;

    @JsonAnySetter
    public void rejectUnknownField(String ignoredName, Object ignoredValue) {
        throw new IllegalArgumentException(I18nUtil.get("mail.connection.fieldUnsupported"));
    }
}
