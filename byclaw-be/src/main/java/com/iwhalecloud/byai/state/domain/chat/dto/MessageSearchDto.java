package com.iwhalecloud.byai.state.domain.chat.dto;

import java.util.List;

import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class MessageSearchDto {
    private String sessionName;

    private Long sessionId;

    /**
     * 会话类型 h_as：人与超级助手/数字员工单聊 hs_as：群聊 h_h：人与人单聊
     */
    private String sessionType;

    private String sessionContent;

    private List<ByaiMessageHotDto> messageDtoList;
}
