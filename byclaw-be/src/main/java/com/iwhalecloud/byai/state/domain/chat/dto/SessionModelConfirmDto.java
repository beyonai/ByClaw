package com.iwhalecloud.byai.state.domain.chat.dto;

import lombok.Getter;
import lombok.Setter;

/** 用户确认的会话模型与思考档位。 */
@Getter
@Setter
public class SessionModelConfirmDto {

    private Long sessionId;

    /** 正数为模型主键，-1 为恢复数字员工默认模型。 */
    private String modelId;

    /** 空表示不改变档位轴，-1 表示跟随模型默认档位。 */
    private String thinkingLevel;
}
