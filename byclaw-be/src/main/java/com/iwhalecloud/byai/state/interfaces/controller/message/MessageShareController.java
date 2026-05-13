package com.iwhalecloud.byai.state.interfaces.controller.message;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.state.domain.message.service.MessageShareService;
import com.iwhalecloud.byai.state.interfaces.controller.message.dto.MessageShareLinkCreateRequest;
import com.iwhalecloud.byai.state.interfaces.controller.message.dto.MessageShareLinkResponse;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.log.exception.MemoryRuntimeException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;


/**
 * 消息分享链接接口
 * <p>
 * 职责：
 * </p>
 * <ul>
 * <li>对外提供为多条消息生成一个分享链接的 HTTP API</li>
 * <li>不直接暴露内部实现细节和敏感信息</li>
 * </ul>
 */
@Slf4j
@RestController
@RequestMapping("/chat/message")
@Tag(name = "消息分享接口", description = "消息分享链接相关接口")
public class MessageShareController {

    private static final Logger logger = LoggerFactory.getLogger(MessageShareController.class);


    @Autowired
    private MessageShareService messageShareService;

    /**
     * 为多条消息生成一个分享链接（application/json 入参）
     *
     * @param request 创建请求，包含消息ID列表和分享链接配置参数
     * @return 分享链接唯一标识（token）
     */
    @Operation(summary = "生成消息分享链接", description = "为多条消息生成一个安全可控的分享链接，返回链接标识（token）")
    @ApiResponses({
        @ApiResponse(responseCode = "0", description = "创建成功",
            content = @Content(mediaType = "application/json", schema = @Schema(implementation = ResponseUtil.class))),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    @PostMapping("/share-link")
    public ResponseUtil<String> createShareLink(@Valid @RequestBody MessageShareLinkCreateRequest request) {
        try {
            String token = messageShareService.createShareLink(request.getMessageIds(), request.getExpireDays(),
                request.getMaxAccessCount(), request.getAccessPermission(), request.getTitle());
            return ResponseUtil.successResponse(token);
        }
        catch (MemoryRuntimeException | BaseException e) {
            logger.error("createShareLink error, messageIds={}, expireDays={}, maxAccessCount={}, accessPermission={}, title={}, err={}",
                request.getMessageIds(), request.getExpireDays(), request.getMaxAccessCount(),
                request.getAccessPermission(), request.getTitle(), e.getMessage(), e);
            return ResponseUtil.fail(e.getMessage());
        }
        catch (Exception e) {
            logger.error("createShareLink unknown error, messageIds={}, expireDays={}, maxAccessCount={}, accessPermission={}, title={}, err={}",
                request.getMessageIds(), request.getExpireDays(), request.getMaxAccessCount(),
                request.getAccessPermission(), request.getTitle(), e.getMessage(), e);
            return ResponseUtil.fail(I18nUtil.get("assistant.chat.server.error"));
        }
    }

    /**
     * 校验分享链接是否可访问，并返回该链接关联的消息ID列表（页面访问链接时调用）
     *
     * @param token 分享链接唯一标识（URL 查询参数）
     * @return 消息ID列表
     */
    @Operation(summary = "校验分享链接并返回消息ID列表", description = "页面访问分享链接时调用，校验链接是否有效并返回关联的消息ID列表")
    @ApiResponses({
        @ApiResponse(responseCode = "0", description = "校验通过，返回 messageIds",
            content = @Content(mediaType = "application/json", schema = @Schema(implementation = ResponseUtil.class))),
        @ApiResponse(responseCode = "500", description = "链接无效、已过期或超过访问次数")
    })
    @GetMapping("/share-link/access")
    public ResponseUtil<MessageShareLinkResponse> validateShareLinkAccess(
        @RequestParam("token") String token,
        HttpServletResponse httpServletResponse) {
        try {
            MessageShareLinkResponse response = messageShareService.validateAccessAndGetMessageIds(token, httpServletResponse);
            return ResponseUtil.successResponse(response);
        }
        catch (BaseException e) {
            logger.error("validateShareLinkAccess error, token={}, err={}", token, e.getMessage(), e);
            return ResponseUtil.fail(e.getMessage());
        }
        catch (Exception e) {
            logger.error("validateShareLinkAccess unknown error, token={}, err={}", token, e.getMessage(), e);
            return ResponseUtil.fail("validateShareLinkAccess error");
        }
    }

}
