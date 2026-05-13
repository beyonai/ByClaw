package com.iwhalecloud.byai.state.interfaces.controller.manage;

import java.util.List;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import com.iwhalecloud.byai.common.feign.request.manager.FindQo;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;
import com.iwhalecloud.byai.common.message.service.ByaiMessageHotService;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.qo.session.ByaiSessionQo;
import com.iwhalecloud.byai.manager.qo.session.SessionByAgentQo;
import com.iwhalecloud.byai.state.application.service.manage.AssistantManApplicationService;
import com.iwhalecloud.byai.state.application.service.message.MessageService;
import com.iwhalecloud.byai.state.application.service.session.SessionApplicationService;
import com.iwhalecloud.byai.state.common.dto.MessageQo;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.state.domain.assitsant.service.ResourcePrivilegeService;
import com.iwhalecloud.byai.state.domain.assitsant.vo.ResourcePrivilegeQueryRequestDto;
import com.iwhalecloud.byai.state.domain.assitsant.vo.ResourcePrivilegeQueryResponseDto;
import com.iwhalecloud.byai.state.domain.assitsant.vo.ResourcePrivilegeRequestDto;
import com.iwhalecloud.byai.state.domain.message.enums.FeedbackTypeEnum;
import com.iwhalecloud.byai.state.domain.message.enums.PraiseAndTreadEnum;
import com.iwhalecloud.byai.state.domain.message.model.MessageFeedbackDto;
import com.iwhalecloud.byai.state.domain.message.model.SessionOpeartorDto;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.extern.slf4j.Slf4j;

/**
 * 1.会话历史消息，点赞点踩，非对话类功能 1.byaiAgent /ByaiAgentController ---> /assiman 2.点赞点踩 /MessageController ---> /assiman 3.会话历史消息
 * core/state/qryConversations ---> /assiman 4.查询会话、更新、修改、删除会话，以及根据sessionId查询所有的消息 /MessageController ---> /assiman
 **/

@Slf4j
@RestController
@RequestMapping("/assiman")
@Validated
@Tag(name = "助理管理", description = "提供会话历史消息、点赞点踩、会话管理等非对话类功能")
public class AssistantManController {

    @Autowired
    private MessageService messageService;

    @Autowired
    private SessionApplicationService sessionApplicationService;

    @Autowired
    private ResourcePrivilegeService resourcePrivilegeService;

    @Autowired
    private AssistantManApplicationService assistantManApplicationService;

    @Autowired
    private SessionMemberService sessionMemberService;

    @Autowired
    private ByaiMessageHotService byaiMessageHotService;

    /**
     * 点赞和点踩
     *
     * @param sessionOpeartorDto
     * @return
     */
    @PostMapping("/updateMessage")
    @Operation(summary = "点赞和点踩", description = "对消息进行点赞或点踩操作")
    @ApiResponses({
        @ApiResponse(responseCode = "0", description = "操作成功"),
        @ApiResponse(responseCode = "400", description = "参数错误：messageId不能为空或type不存在"),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil updateMessage(@RequestBody SessionOpeartorDto sessionOpeartorDto) {
        String messageId = sessionOpeartorDto.getMessageId();
        // 得到点赞/点踩
        String type = sessionOpeartorDto.getType();
        if (StringUtils.isBlank(messageId)) {
            throw new BdpRuntimeException(I18nUtil.get("assistant.man.message.id.not.empty"));
        }
        PraiseAndTreadEnum praiseAndTreadEnum = PraiseAndTreadEnum.getName(type);
        if (PraiseAndTreadEnum.getName(type) == null) {
            throw new BdpRuntimeException(I18nUtil.get("assistant.man.type.exists"));
        }
        // 先查出当前的消息内容，替换掉metadata数据
        ByaiMessageHotDto byaiMessageHotDto = byaiMessageHotService.findById(Long.valueOf(messageId));

        String metadata = messageService.updateMessage(sessionOpeartorDto, praiseAndTreadEnum, byaiMessageHotDto);

        return ResponseUtil.successResponse("update message success", metadata);
    }

    /**
     * 已解决和未解决
     *
     * @param messageFeedbackDto 消息反馈类型
     * @return ResponseUtil
     */
    @PostMapping("/updateMesFeedback")
    @Operation(summary = "已解决和未解决", description = "对消息进行已解决和未解决操作")
    @ApiResponses({
        @ApiResponse(responseCode = "0", description = "操作成功"),
        @ApiResponse(responseCode = "400", description = "参数错误：messageId不能为空或type不存在"),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil updateMesFeedback(@RequestBody @Valid MessageFeedbackDto messageFeedbackDto) {
        Long messageId = messageFeedbackDto.getMessageId();
        // 得到已解决和未解决
        String type = messageFeedbackDto.getType();
        if (messageId == null) {
            throw new BdpRuntimeException(I18nUtil.get("assistant.man.message.id.not.empty"));
        }
        PraiseAndTreadEnum praiseAndTreadEnum = PraiseAndTreadEnum.getName(type);
        if (null == praiseAndTreadEnum) {
            throw new BdpRuntimeException(I18nUtil.get("assistant.man.type.not.exist"));
        }
        FeedbackTypeEnum feedbackTypeEnum = FeedbackTypeEnum.getName(messageFeedbackDto.getFeedbackLabel());
        if (praiseAndTreadEnum == PraiseAndTreadEnum.TREAD && feedbackTypeEnum == null) {
            throw new BdpRuntimeException(I18nUtil.get("assistant.man.type.not.exist"));
        }
        // 先查出当前的消息内容，替换掉metadata数据
        ByaiMessageHotDto byaiMessageHotDto = byaiMessageHotService.findById(messageId);

        String metadata = messageService.updateMesFeedback(messageFeedbackDto, praiseAndTreadEnum, byaiMessageHotDto);

        return ResponseUtil.successResponse("update message success", metadata);
    }

    /**
     * 查询历史会话消息
     *
     * @return
     */
    @PostMapping("/qryConversations")
    @Operation(summary = "查询历史会话", description = "分页查询历史会话消息")
    @ApiResponses({
        @ApiResponse(responseCode = "0", description = "查询成功"),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil qryConversations(@RequestBody ByaiSessionQo byaiSessionQo) {
        return ResponseUtil.successResponse(sessionApplicationService.qryConversations(byaiSessionQo));
    }

    /**
     * 更新会话
     *
     * @param sessionOpeartorDto 入参
     * @return ResponseUtil
     */
    @PostMapping("/updateConversation")
    @Operation(summary = "更新会话", description = "更新会话信息")
    @ApiResponses({
        @ApiResponse(responseCode = "0", description = "更新成功"),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil updateConversation(@RequestBody SessionOpeartorDto sessionOpeartorDto) {
        return ResponseUtil.successResponse(sessionApplicationService.updateConversation(sessionOpeartorDto));
    }

    /***
     * 删除会话
     *
     * @param sessionId 会话标识
     * @return ResponseUtil
     */
    @GetMapping("/removeConversation")
    @Operation(summary = "删除会话", description = "根据会话ID删除指定会话")
    @ApiResponses({
        @ApiResponse(responseCode = "0", description = "删除成功"),
        @ApiResponse(responseCode = "400", description = "会话ID不能为空"),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil removeConversation(
        @Parameter(description = "会话ID", required = true) @RequestParam(name = "sessionId") Long sessionId) {
        sessionApplicationService.removeConversation(sessionId);
        return ResponseUtil.success("OK");
    }

    /**
     * 根据sessionid获取消息列表
     *
     * @param messageQo
     * @return
     */
    @PostMapping("/getMessages")
    @Operation(summary = "获取会话消息列表", description = "根据会话ID获取消息列表")
    @ApiResponses({
        @ApiResponse(responseCode = "0", description = "查询成功"),
        @ApiResponse(responseCode = "400", description = "会话ID不能为空"),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil getMessages(@RequestBody MessageQo messageQo) {
        // 根据sessionId获取消息列表
        if (messageQo.getSessionId() != null && messageQo.getSessionId().equals(0L)) {
            throw new BdpRuntimeException(I18nUtil.get("assistant.man.session.id.not.empty"));
        }
        messageQo.initPage();
        return ResponseUtil.successResponse(messageService.getMessages(messageQo));
    }

    @GetMapping("/getForwardMessage/{messageId}")
    @Operation(summary = "获取会话消息列表", description = "根据消息ID获取转发消息列表")
    @ApiResponses({
        @ApiResponse(responseCode = "0", description = "查询成功"),
        @ApiResponse(responseCode = "400", description = "消息ID不能为空"),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil getForwardMessages(@PathVariable("messageId") Long messageId) {
        return ResponseUtil.successResponse(messageService.getForwardMessages(messageId));
    }

    @PostMapping("/getMessageByIds")
    @Operation(summary = "获取消息列表", description = "根据消息ID获取消息列表")
    @ApiResponses({
        @ApiResponse(responseCode = "0", description = "查询成功"),
        @ApiResponse(responseCode = "400", description = "消息ID不能为空"),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil getForwardMessages(@RequestBody MessageQo messageQo) {
        return ResponseUtil.successResponse(messageService.getMessageByIds(messageQo));
    }

    /**
     * 删除消息
     *
     * @param sessionOpeartorDto
     * @return
     */
    @PostMapping("/deleteMessage")
    @Operation(summary = "删除消息", description = "根据消息ID删除指定消息")
    @ApiResponses({
        @ApiResponse(responseCode = "0", description = "删除成功"),
        @ApiResponse(responseCode = "400", description = "消息ID不能为空"),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil deleteMessage(@RequestBody SessionOpeartorDto sessionOpeartorDto) {
        String messageId = sessionOpeartorDto.getMessageId();
        if (StringUtils.isBlank(messageId)) {
            throw new BdpRuntimeException(I18nUtil.get("assistant.man.message.id.not.empty"));
        }
        messageService.deleteMessage(messageId);
        return ResponseUtil.success("delete success");
    }

    /**
     * 点踩时查询反馈类型
     *
     * @param
     * @return
     */
    @GetMapping("/getContentFeedbackType")
    @Operation(summary = "查询反馈类型", description = "点踩时查询反馈类型")
    @ApiResponses({
        @ApiResponse(responseCode = "0", description = "查询成功"),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil getContentFeedbackType() {

        return ResponseUtil.successResponse(messageService.getContentFeedbackType());
    }

    /**
     * 模糊查询数字员工和企业人员
     *
     * @param
     * @return
     */
    @PostMapping("/find")
    @Operation(summary = "模糊查询人员", description = "模糊查询数字员工和企业人员")
    @ApiResponses({
        @ApiResponse(responseCode = "0", description = "查询成功"),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil find(@RequestBody FindQo findUserDto) {
        return ResponseUtil.successResponse(assistantManApplicationService.find(findUserDto));
    }

    /**
     * 保存助理资源授权信息 支持新增和修改数据
     *
     * @param requestDto 请求参数对象
     * @return ResponseUtil
     */
    @PostMapping("/saveResourcePrivilege")
    @Operation(summary = "保存助理资源授权信息", description = "保存助理资源授权信息，支持新增和修改数据")
    @ApiResponses({
        @ApiResponse(responseCode = "0", description = "保存成功"),
        @ApiResponse(responseCode = "400", description = "参数错误"),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil<String> saveResourcePrivilege(@Valid @RequestBody ResourcePrivilegeRequestDto requestDto) {
        log.info("开始保存助理资源授权信息 - 授权类型: {}, 知识资源数量: {}, 数据资源数量: {}", requestDto.getPrivilegeType(),
            requestDto.getKnowledgeList() != null ? requestDto.getKnowledgeList().size() : 0,
            requestDto.getDataList() != null ? requestDto.getDataList().size() : 0);

        // 调用service层处理业务逻辑
        boolean result = resourcePrivilegeService.saveResourcePrivilege(requestDto);
        return result ? ResponseUtil.successResponse("保存成功") : ResponseUtil.fail("保存失败");
    }

    /**
     * 查询用户已选择的资源权限 优先查询新表，如果新表无记录则查询旧表作为默认权限 支持同时查询多种权限类型和资源类型
     *
     * @param requestDto 查询请求参数
     * @return ResponseUtil
     */
    @PostMapping("/getUserSelectedResourcePrivileges")
    @Operation(summary = "查询用户已选择的资源权限", description = "查询当前登录用户已选择的资源权限，支持同时查询多种权限类型和资源类型，优先查询新表，无记录时查询旧表作为默认权限")
    @ApiResponses({
        @ApiResponse(responseCode = "0", description = "查询成功"),
        @ApiResponse(responseCode = "400", description = "参数错误"),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil getUserSelectedResourcePrivileges(
        @Valid @RequestBody ResourcePrivilegeQueryRequestDto requestDto) {
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        if (currentUserId == null) {
            return ResponseUtil.fail("获取当前用户信息失败");
        }

        log.info("开始查询用户已选择的资源权限，用户ID: {}, 权限类型列表: {}, 资源类型列表: {}", currentUserId, requestDto.getPrivilegeTypes(),
            requestDto.getResourceTypes());

        List<ResourcePrivilegeQueryResponseDto> privileges = resourcePrivilegeService.getUserResourcePrivilegesBatch(
            currentUserId, requestDto.getPrivilegeTypes(), requestDto.getResourceTypes());

        return ResponseUtil.successResponse(privileges);
    }

    /**
     * 查询用户全部可用资源列表 查询通用权限授权表中的所有可用资源 支持同时查询多种权限类型和资源类型
     *
     * @param requestDto 查询请求参数
     * @return ResponseUtil
     */
    @PostMapping("/getUserAllAvailableResources")
    @Operation(summary = "查询用户全部可用资源列表", description = "查询当前登录用户可用的全部资源列表，支持同时查询多种权限类型和资源类型")
    @ApiResponses({
        @ApiResponse(responseCode = "0", description = "查询成功"),
        @ApiResponse(responseCode = "400", description = "参数错误"),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil getUserAllAvailableResources(@Valid @RequestBody ResourcePrivilegeQueryRequestDto requestDto) {
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        if (currentUserId == null) {
            return ResponseUtil.fail("获取当前用户信息失败");
        }

        log.info("开始查询用户全部可用资源列表，用户ID: {}, 权限类型列表: {}, 资源类型列表: {}", currentUserId, requestDto.getPrivilegeTypes(),
            requestDto.getResourceTypes());

        List<ResourcePrivilegeQueryResponseDto> privileges = resourcePrivilegeService
            .getUserDefaultResourcePrivilegesBatch(currentUserId, requestDto.getPrivilegeTypes(),
                requestDto.getResourceTypes());

        return ResponseUtil.successResponse(privileges);
    }

    /**
     * 根据数字员工标识查询会话信息
     *
     * @param sessionByAgentQo 数字员工标识
     * @return ResponseUtil
     */
    @PostMapping("/querySessionByAgent")
    public ResponseUtil<PageInfo<Map<String, Object>>> querySessionByAgent(
        @RequestBody SessionByAgentQo sessionByAgentQo) {
        PageInfo<Map<String, Object>> pageInfo = sessionMemberService.querySessionByAgent(sessionByAgentQo);
        return ResponseUtil.successResponse(pageInfo);
    }
}
