package com.iwhalecloud.byai.state.domain.message.qo;

import lombok.Data;

@Data
public class MessageQo {
    public Long sessionId;

    public Integer topK;

    /** 创建用户 ID；内部开放接口会强制写入当前登录用户，防止越权。 */
    public Long creatorId;
}
