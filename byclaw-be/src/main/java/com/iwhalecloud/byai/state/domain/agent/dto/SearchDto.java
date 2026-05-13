package com.iwhalecloud.byai.state.domain.agent.dto;

import java.util.List;

import com.iwhalecloud.byai.manager.vo.index.DigitEmployMarketVo;
import com.iwhalecloud.byai.state.domain.chat.dto.MessageSearchDto;
import com.iwhalecloud.byai.common.feign.request.manager.SearchUser;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class SearchDto {

    private List<DigitEmployMarketVo> digitList;

    private List<SearchUser> userList;

    private List<MessageSearchDto> sessionList;
}
