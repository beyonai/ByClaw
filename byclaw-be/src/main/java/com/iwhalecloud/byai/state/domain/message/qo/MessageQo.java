package com.iwhalecloud.byai.state.domain.message.qo;

import lombok.Data;

@Data
public class MessageQo {
    public Long sessionId;

    public Integer topK;
}
