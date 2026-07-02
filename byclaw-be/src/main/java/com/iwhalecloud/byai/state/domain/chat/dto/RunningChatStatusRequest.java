package com.iwhalecloud.byai.state.domain.chat.dto;

import java.util.List;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class RunningChatStatusRequest {

    private List<Long> sessionIds;
}
