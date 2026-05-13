package com.iwhalecloud.byai.state.domain.agent.enums;

import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import lombok.Getter;

/**
 * @author zht
 * @version 1.0
 * @date 2025/5/22
 */
@Getter
public enum MessageRoleEnum {

    USER(1, "user"),

    ASSISTANT(2, "assistant");

    private final Integer num;

    private final String code;

    MessageRoleEnum(Integer num, String code) {
        this.num = num;
        this.code = code;
    }

    public static String roleCode(Integer num) {
        for (MessageRoleEnum value : values()) {
            if (value.num.equals(num)) {
                return value.code;
            }
        }
        throw new BdpRuntimeException(I18nUtil.get("message.role.enum.role.num.is.not.custom"));
    }
}
