package com.iwhalecloud.byai.state.interfaces.controller.chat;

import java.io.IOException;
import com.iwhalecloud.byai.common.constants.superassist.SessionType;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AiModelService;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;
import com.iwhalecloud.byai.common.message.service.ByaiMessageHotService;
import com.iwhalecloud.byai.manager.dto.resource.UploadResult;
import com.iwhalecloud.byai.state.application.service.callback.CallbackApplicationService;
import com.iwhalecloud.byai.state.application.service.chat.AssistantChatApplicationService;
import com.iwhalecloud.byai.state.domain.callback.dto.CallbackRequest;
import com.iwhalecloud.byai.state.domain.chat.dto.StopChatDto;
import jakarta.servlet.http.HttpServletRequest;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import com.iwhalecloud.byai.state.application.service.message.MessageService;
import com.iwhalecloud.byai.state.domain.assitsant.service.SuperassistService;
import com.iwhalecloud.byai.state.domain.chat.dto.MessageFormSubmitDto;
import com.iwhalecloud.byai.state.domain.chat.dto.MessageTaskDto;
import com.iwhalecloud.byai.state.application.service.task.TaskService;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.state.infrastructure.utils.CompletionsUtils;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.state.domain.session.dto.MessageDto;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.multipart.MultipartFile;

/**
 * 聊天接口
 **/
@Slf4j
@RestController
@RequestMapping("/chat")
@Tag(name = "对话接口", description = "数字助理对话相关接口")
public class AssistantChatController {

    private static final Logger logger = LoggerFactory.getLogger(AssistantChatController.class);

    @Autowired
    MessageService messageService;

    @Autowired
    private SuperassistService superassistService;

    @Autowired
    private AiModelService aiModelService;

    @Autowired
    private TaskService taskService;

    @Autowired
    private CallbackApplicationService callbackApplicationService;

    @Autowired
    private AssistantChatApplicationService assistantChatApplicationService;

    @Autowired
    private ByaiMessageHotService byaiMessageHotService;

    @Operation(summary = "获取消息详情(提供给问数，慧笔，鲸灵)", description = "根据消息ID获取消息详情，副驾调用主驾", responses = {
        @ApiResponse(responseCode = "0", description = "获取成功",
            content = @Content(mediaType = "application/json", schema = @Schema(implementation = ResponseUtil.class))),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    @GetMapping(value = "/getMessageById")
    public ResponseUtil getMessageById(
        @Parameter(description = "消息ID", required = true) @RequestParam(name = "messageId") String messageId) {
        if (StringUtils.isBlank(messageId)) {
            throw new BdpRuntimeException(I18nUtil.get("assistant.chat.message.id.not.empty"));
        }
        ByaiMessageHotDto byaiMessageHotDto = byaiMessageHotService.findById(Long.valueOf(messageId));
        return ResponseUtil.successResponse(byaiMessageHotDto);
    }

    @Operation(summary = "获取助理信息", description = "获取数字助理的基本信息", responses = {
        @ApiResponse(responseCode = "0", description = "获取成功",
            content = @Content(mediaType = "application/json", schema = @Schema(implementation = ResponseUtil.class))),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    @PostMapping("/getAssistant")
    public ResponseUtil getAssistant() {
        return ResponseUtil.successResponse(superassistService.getAssistant(CurrentUserHolder.getAssistantId()));
    }

    @Operation(summary = "获取AI模型列表", description = "获取百应AI模型列表", responses = {
        @ApiResponse(responseCode = "0", description = "获取成功",
            content = @Content(mediaType = "application/json", schema = @Schema(implementation = ResponseUtil.class))),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    @PostMapping("/getAiModeList")
    public ResponseUtil getAiModeList() {
        return ResponseUtil.successResponse(aiModelService.getModelList());
    }

    /**
     * 查看消息sse
     *
     * @param messageDto 入参
     * @return Flux<String> SSE流，流式输出消息内容
     */
    @RequestMapping(value = "/getMessageStream", method = RequestMethod.POST,
        produces = "text/event-stream;charset=UTF-8")
    @Operation(summary = "调试智能体对话", description = "与数字员工进行对话调试，支持流式输出")
    @ApiResponses(value = {
        @ApiResponse(responseCode = "200", description = "对话成功"),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public void getMessageStream(HttpServletResponse res, @RequestBody MessageDto messageDto) throws IOException {
        if (messageDto.getMessageId() == null) {
            throw new BdpRuntimeException(I18nUtil.get("assistant.chat.message.id.not.empty"));
        }
        if (messageDto.getSessionId() == null) {
            throw new BdpRuntimeException(I18nUtil.get("assistant.chat.session.id.not.empty"));
        }
        CompletionsUtils.setResHeader(res, true);
        messageService.getMessageStream(res.getOutputStream(), messageDto);
    }

    /**
     * 智能体表单提交接口
     *
     * @return ResponseUtil
     */
    @Operation(summary = "智能体表单提交接口", description = "智能体表单提交接口")
    @PostMapping(value = "/submitForm")
    public ResponseUtil submitForm(@RequestBody MessageFormSubmitDto messageFormSubmitDto) {
        return taskService.submitForm(messageFormSubmitDto);
    }

    @Operation(summary = "手动修改任务校验", description = "手动修改任务校验")
    @PostMapping(value = "/validateTask")
    public ResponseUtil validateTask(@RequestBody MessageTaskDto messageTaskDto) {
        return ResponseUtil.successResponse(taskService.validateTask(messageTaskDto));
    }

    @Operation(summary = "手动修改任务", description = "手动修改任务")
    @PostMapping(value = "/manualTask")
    public ResponseUtil customTask(@RequestBody MessageTaskDto messageTaskDto) {
        return ResponseUtil.successResponse(taskService.manualTask(messageTaskDto));
    }

    @GetMapping(value = "/session/callback/search")
    public ResponseUtil callbackSearch(CallbackRequest request) {
        return callbackApplicationService.callBackSearch(request);
    }

    /**
     * 预览消息中的 html 内容
     *
     * @param messageId 消息ID
     * @param segment 段落标识
     * @param response HTTP响应对象
     * @throws IOException IO异常
     */
    @GetMapping(value = "/share/html", produces = "text/html;charset=UTF-8")
    public void previewHtml(@Parameter(description = "消息ID", required = true) @RequestParam("messageId") Long messageId,
        @Parameter(description = "段落标识", required = true) @RequestParam("segment") Integer segment,
        HttpServletResponse response) throws IOException {

        log.info("获取公共消息内容 - messageId: {}, segment: {}", messageId, segment);

        response.setContentType("text/html;charset=UTF-8");
        response.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        response.setHeader("Pragma", "no-cache");
        response.setHeader("Expires", "0");

        // 调用服务层获取消息内容（异常已在Service层处理）
        String messageContent = messageService.getMessageContent(messageId, segment);

        // 直接返回内容
        response.getWriter().write(messageContent);
        response.getWriter().flush();

        log.info("消息内容获取成功 - messageId: {}, segment: {}", messageId, segment);
    }

    /**
     * 停止会话接口
     *
     * @param stopChatDto 入参
     * @return ResponseUtil
     */
    @PostMapping(value = "/stopChat")
    public ResponseUtil<String> stopChat(HttpServletRequest request, @RequestBody StopChatDto stopChatDto) {

        try {
            assistantChatApplicationService.stopChat(stopChatDto);
        }
        catch (Exception e) {
            log.error(e.getMessage(), e);
        }
        return ResponseUtil.success("OK");
    }

    /**
     * 上传文件
     *
     * @param files 文件
     * @param sessionId 会话标识
     * @return ResponseUtil
     */

    @PostMapping("/uploadFiles")
    public ResponseUtil<UploadResult> uploadFiles(
        @Parameter(description = "要上传的文件列表", required = true) @RequestParam("files") MultipartFile[] files,
        @Parameter(description = "会话ID，可选") @RequestParam(value = "sessionId", required = false) Long sessionId,
        @Parameter(description = "会话类型，可选") @RequestParam(value = "sessionType", required = false,
            defaultValue = SessionType.SUPER_AGENT) String sessionType,
        @Parameter(description = "数字员工，可选") @RequestParam(value = "agentId", required = false) Long agentId) {
        try {
            UploadResult uploadResult = assistantChatApplicationService.uploadFiles(files, sessionId, sessionType,
                agentId);
            return ResponseUtil.success(uploadResult);
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
            return ResponseUtil.fail(e.getMessage());
        }
    }

}
