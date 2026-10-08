package com.iwhalecloud.byai.manager.interfaces.controller.conversation;

import com.iwhalecloud.byai.common.constants.ConversationSearchConstants;
import com.iwhalecloud.byai.common.message.dto.MemRelSearchReponseDto;
import com.iwhalecloud.byai.common.message.dto.PageResult;
import com.iwhalecloud.byai.manager.application.service.conversation.ConversationSearchSkillService;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.qo.conversation.ConversationSearchQo;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
public class ConversationSearchSkillController {

    private final ConversationSearchSkillService service;

    @PostMapping(ConversationSearchConstants.QUERY_PATH)
    public ResponseUtil<PageResult<MemRelSearchReponseDto>> search(@RequestBody ConversationSearchQo query) {
        return ResponseUtil.successResponse(service.search(query));
    }
}
