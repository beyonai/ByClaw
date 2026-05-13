package com.iwhalecloud.byai.manager.interfaces.controller.conversation;

import java.util.List;
import java.util.Map;

import com.iwhalecloud.byai.manager.application.service.conversation.ConversationExportService;
import com.iwhalecloud.byai.manager.entity.staticdata.ByaiSystemConfigList;
import com.iwhalecloud.byai.manager.qo.conversation.FilterQo;
import com.iwhalecloud.byai.manager.qo.conversation.HandleFeedbackMsgQo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import jakarta.servlet.http.HttpServletResponse;

import com.iwhalecloud.byai.manager.qo.conversation.MessageQo;
import com.iwhalecloud.byai.manager.application.service.conversation.ConversationService;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;

@RestController
@RequestMapping("/system/message")
public class ConversationController {

    @Autowired
    private ConversationService conversationService;

    @Autowired
    private ConversationExportService conversationExportService;

    /*
     * 查询对话列表
     */
    @PostMapping("/list")
    public ResponseUtil query(@RequestBody MessageQo query) {
        Map<String, Object> resList = conversationService.getMessageList(query);
        return ResponseUtil.successResponse(I18nUtil.get("conversation.message.list.query.success"), resList);
    }

    @GetMapping("/accessTerminalList")
    public ResponseUtil<List<ByaiSystemConfigList>> accessTerminalList() {
        return conversationService.getAccessTerminalList();
    }

    @GetMapping("/projectIdList")
    public ResponseUtil getProjectIdList() {
        return conversationService.getProjectIdList();
    }

    @GetMapping("/getContentFeedbackType")
    public ResponseUtil getContentFeedbackType() {
        return ResponseUtil.successResponse(I18nUtil.get("conversation.feedback.type.query.success"),
            conversationService.getContentFeedbackType());
    }

    @PostMapping("/getSuassList")
    public ResponseUtil getSuassList(@RequestBody FilterQo qo) {
        return ResponseUtil.successResponse(I18nUtil.get("conversation.suass.list.query.success"),
            conversationService.getSuassList(qo));
    }

    @PostMapping("/handleFeedbackMsg")
    public ResponseUtil handleFeedbackMsg(@RequestBody HandleFeedbackMsgQo qo) {
        conversationService.handleFeedbackMsg(qo);
        return ResponseUtil.success(I18nUtil.get("conversation.feedback.handle.success"));
    }

    /**
     * 导出对话消息列表
     *
     * @param httpServletResponse HTTP响应对象
     * @param messageQo 查询参数（与列表查询保持一致）
     */
    @PostMapping("/export")
    public void exportMessageList(HttpServletResponse httpServletResponse, @RequestBody MessageQo messageQo) {
        conversationExportService.exportMessageList(httpServletResponse, messageQo);
    }
}
