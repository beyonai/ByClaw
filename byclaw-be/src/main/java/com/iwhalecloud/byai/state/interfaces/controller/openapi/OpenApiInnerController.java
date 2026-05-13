package com.iwhalecloud.byai.state.interfaces.controller.openapi;

import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;
import com.iwhalecloud.byai.state.domain.message.qo.MessageQo;
import com.iwhalecloud.byai.common.message.service.ByaiMessageHotService;
import java.util.List;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.extern.slf4j.Slf4j;

/**
 * 聊天接口
 **/
@Slf4j
@RestController
@RequestMapping("/open/api/inner")
@Tag(name = "内部接口", description = "内部接口")
public class OpenApiInnerController {

    @Autowired
    private ByaiMessageHotService messageService;

    @PostMapping("/getMessages")
    public ResponseUtil getMessages(@RequestBody MessageQo messageQo) {
        List<ByaiMessageHotDto> messages = messageService.getMessages(messageQo);
        return ResponseUtil.successResponse(messages);
    }
}
