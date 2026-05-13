package com.iwhalecloud.byai.state.interfaces.controller.openapi;

import com.iwhalecloud.byai.common.annotation.Add;
import com.iwhalecloud.byai.common.annotation.ManageLogAnnotation;
import com.iwhalecloud.byai.common.annotation.Mod;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;
import com.iwhalecloud.byai.common.message.qo.MessageHotPageQo;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.dto.session.ByaiSessionDto;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.qo.session.ByaiSessionQo;
import com.iwhalecloud.byai.state.application.service.chat.OpenApiConversationApplicationService;
import com.iwhalecloud.byai.state.application.service.message.MessageService;
import com.iwhalecloud.byai.state.domain.chat.dto.ExternalMessageVo;
import com.iwhalecloud.byai.state.domain.message.model.SessionOpeartorDto;
import com.iwhalecloud.byai.state.domain.session.dto.ConversationFilePathDto;
import com.iwhalecloud.byai.state.domain.session.qo.ConversationAppendTxtQo;
import com.iwhalecloud.byai.state.domain.session.qo.ConversationReadQo;
import com.iwhalecloud.byai.state.domain.session.qo.ConversationWriteTxtQo;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

/**
 * 会话文件开放接口（免登录）。 设计说明： 1. Controller 只负责开放协议适配和异常转译； 2. 具体 bucket / objectKey 规则、兜底建桶、文件读写逻辑全部下沉到应用服务； 3. read
 * 走流式输出，避免大文件读取时一次性在接口层组装完整响应体。 qin.guoquan 2026-04-17
 */
@RestController
@RequestMapping("/open/api")
@Slf4j
public class OpenApiConversationController {

    @Autowired
    private MessageService messageService;

    @Autowired
    private OpenApiConversationApplicationService openApiConversationApplicationService;

    /**
     * 覆盖写会话文件。 流程步骤： 1. Controller 接收入参并交给应用服务； 2. 应用服务统一校验 userCode / sessionId / filePath，并兜底初始化用户桶； 3. 按
     * .sessions/{sessionId}/{filePath} 规则定位对象路径； 4. 覆盖写入 MinIO； 5. 返回 filePath 给调用方，便于前端继续按同一路径做追加或读取。
     */
    @PostMapping("/v1/conversation/writeTxt")
    @ManageLogAnnotation(name = "会话API调用", description = "开放接口覆盖写会话文件")
    public ResponseUtil<ConversationFilePathDto> writeTxt(@RequestBody ConversationWriteTxtQo qo) {
        try {
            return ResponseUtil.successResponse(openApiConversationApplicationService.writeTxt(qo));
        }
        catch (Exception e) {
            log.error("开放接口覆盖写会话文件失败, userCode={}, sessionId={}, filePath={}", qo.getUserCode(), qo.getSessionId(),
                qo.getFilePath(), e);
            return ResponseUtil.fail("写入会话文件失败：" + e.getMessage());
        }
    }

    /**
     * 追加写会话文件。 流程步骤： 1. Controller 只做协议适配，不直接处理 MinIO； 2. 应用服务复用和 writeTxt 相同的桶名、对象路径规则； 3. 底层文件服务先读原文件内容，不存在则按空文件处理；
     * 4. 将新内容追加到末尾后整体覆盖上传； 5. 返回 filePath，保持调用侧的路径语义稳定。
     */
    @PostMapping("/v1/conversation/appendTxt")
    @ManageLogAnnotation(name = "会话API调用", description = "开放接口追加写会话文件")
    public ResponseUtil<ConversationFilePathDto> appendTxt(@RequestBody ConversationAppendTxtQo qo) {
        try {
            return ResponseUtil.successResponse(openApiConversationApplicationService.appendTxt(qo));
        }
        catch (Exception e) {
            log.error("开放接口追加写会话文件失败, userCode={}, sessionId={}, filePath={}", qo.getUserCode(), qo.getSessionId(),
                qo.getFilePath(), e);
            return ResponseUtil.fail("追加会话文件失败：" + e.getMessage());
        }
    }

    /**
     * 按行流式读取会话文件。 这里直接返回文本流，避免为了兼容 JSON 包装而破坏大文件读取体验。 流程步骤： 1. 应用服务统一解析 bucket 和 objectKey，并校验 begin_line / end_line；
     * 2. 底层文件服务按 UTF-8 逐行读取 MinIO 对象； 3. 根据 begin_line / end_line 截取命中行； 4. 通过 StreamingResponseBody 直接把文本流回前端。
     */
    @PostMapping("/v1/conversation/read")
    @ManageLogAnnotation(name = "会话API调用", description = "开放接口按行读取会话文件")
    public ResponseEntity<StreamingResponseBody> read(@RequestBody ConversationReadQo qo) {
        try {
            StreamingResponseBody responseBody = openApiConversationApplicationService.read(qo);
            log.info(
                "开放接口读取会话文件返回StreamingResponseBody成功, userCode={}, sessionId={}, filePath={}, beginLine={}, endLine={}",
                qo.getUserCode(), qo.getSessionId(), qo.getFilePath(), qo.getBeginLine(), qo.getEndLine());
            return ResponseEntity.ok().contentType(MediaType.parseMediaType("text/plain; charset=UTF-8"))
                .body(responseBody);
        }
        catch (Exception e) {
            log.error("开放接口读取会话文件失败, userCode={}, sessionId={}, filePath={}, beginLine={}, endLine={}",
                qo.getUserCode(), qo.getSessionId(), qo.getFilePath(), qo.getBeginLine(), qo.getEndLine(), e);
            String errorMessage = "读取会话文件失败：" + e.getMessage();
            return ResponseEntity.badRequest().contentType(MediaType.parseMediaType("text/plain; charset=UTF-8")).body(
                outputStream -> outputStream.write(errorMessage.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        }
    }

    /**
     * 对开放，创建会话，v1版本
     *
     * @param session 会话信息
     * @return ResponseUtil
     */
    @PostMapping("/v1/createSession")
    @ManageLogAnnotation(name = "会话API调用", description = "创建会话")
    public ResponseUtil<ByaiSession> createSession(@RequestBody @Validated(Add.class) ByaiSession session) {
        ByaiSession byaiSession = openApiConversationApplicationService.createSession(session);
        return ResponseUtil.successResponse(byaiSession);
    }

    /***
     * @param updateSession session信息
     * @return ResponseUtil
     */
    @PostMapping("/v1/updateSession")
    @ManageLogAnnotation(name = "会话API调用", description = "更新会话")
    public ResponseUtil<ByaiSession> updateSession(@RequestBody @Validated(Mod.class) ByaiSession updateSession) {
        ByaiSession byaiSession = openApiConversationApplicationService.updateSession(updateSession);
        return ResponseUtil.successResponse(byaiSession);
    }

    /**
     * 驾调用主驾
     *
     * @param externalMessageVo 入参
     * @return ByaiMessageHotDto
     */
    @PostMapping(value = "/v1/addOrUpdateMessage")
    @ManageLogAnnotation(name = "会话API调用", description = "新增或修改消息")
    public ResponseUtil<ByaiMessageHotDto> addOrUpdateMessage(@RequestBody ExternalMessageVo externalMessageVo) {
        ByaiMessageHotDto byaiMessageHotDto = messageService.addOrUpdateMessage(externalMessageVo);
        return ResponseUtil.successResponse(byaiMessageHotDto);
    }

    /**
     * 删除消息
     *
     * @param sessionOpeartorDto 删除消息
     * @return ResponseUtil
     */
    @PostMapping("/deleteMessage")
    @ManageLogAnnotation(name = "会话API调用", description = "删除消息")
    public ResponseUtil<String> deleteMessage(@RequestBody SessionOpeartorDto sessionOpeartorDto) {
        messageService.deleteMessage(sessionOpeartorDto.getMessageId());
        return ResponseUtil.successResponse();
    }

    /**
     * 查询当前用户的会话列表
     *
     * @param byaiSessionQo 查询对象
     * @return ResponseUtil
     */
    @PostMapping("/v1/qrySessionsByQo")
    public ResponseUtil<PageInfo<ByaiSessionDto>> qrySessionByQo(@RequestBody ByaiSessionQo byaiSessionQo) {
        PageInfo<ByaiSessionDto> pageInfo = openApiConversationApplicationService.qrySessionsByQo(byaiSessionQo);
        return ResponseUtil.successResponse(pageInfo);
    }

    /**
     * 查询消息列表
     *
     * @param messageHotPageQo 查询对象
     * @return ResponseUtil
     */
    @PostMapping("/v1/qryMessagesByQo")
    public ResponseUtil<PageInfo<ByaiMessage>> qryMessagesByQo(@RequestBody MessageHotPageQo messageHotPageQo) {
        PageInfo<ByaiMessage> pageInfo = openApiConversationApplicationService.qryMessagesByQo(messageHotPageQo);
        return ResponseUtil.successResponse(pageInfo);
    }

}
