package com.iwhalecloud.byai.state.interfaces.controller.manage;

import com.iwhalecloud.byai.state.domain.template.service.TemplateSessionService;
import com.iwhalecloud.byai.state.interfaces.controller.manage.dto.TemplateSessionDetailRequestDto;
import com.iwhalecloud.byai.state.interfaces.controller.manage.dto.TemplateSessionSaveRequestDto;
import com.iwhalecloud.byai.manager.entity.staticdata.ByaiSystemConfigList;
import com.iwhalecloud.byai.state.domain.session.dto.TemplateMessageEditRequestDto;
import com.iwhalecloud.byai.state.domain.session.dto.TemplateSessionDetailResponseDto;
import com.iwhalecloud.byai.manager.dto.session.TemplateSessionQueryRequestDto;
import com.iwhalecloud.byai.manager.dto.session.TemplateSessionQueryResponseDto;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import java.util.List;

/**
 * 模板会话管理控制器
 * <p>
 * 提供模板会话的保存、查询、详情查看等功能。 分页查询接口支持匿名访问。
 * </p>
 *
 * @author smartcloud
 * @version 1.0
 * @since 1.0
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/template-sessions")
@Tag(name = "模板会话管理", description = "提供模板会话的保存、查询、详情查看等功能，分页查询支持匿名访问")
public class TemplateSessionController {

    @Autowired
    private TemplateSessionService templateSessionService;

    @Autowired
    private ByaiSystemConfigService byaiSystemConfigService;

    /**
     * 保存或更新会话模板
     * <p>
     * 将指定会话保存为模板，支持设置模板标题、图片和类型。 只有平台管理员才能执行此操作。
     * </p>
     *
     * @param request 保存请求
     * @return ResponseUtil 保存结果
     */
    @PostMapping(value = "/saveOrUpdateTemplate", consumes = "multipart/form-data;charset=UTF-8")
    public ResponseUtil<Long> saveOrUpdateTemplate(
        @Parameter(description = "保存请求", required = true) @Valid TemplateSessionSaveRequestDto request) {

        log.info(
            "开始保存会话模板 - sessionId: {}, userId: {}, templateTitle: {}, templateType: {}, coverId: {}, templateConfig: {}",
            request.getSessionId(), CurrentUserHolder.getCurrentUserId(), request.getTemplateTitle(),
            request.getTemplateType(), request.getCoverId(), request.getTemplateConfig());

        // 调用服务层保存模板，异常由全局异常处理器处理
        Long templateSessionId = templateSessionService.saveOrUpdateTemplate(request.getSessionId(), request);

        log.info("会话模板保存成功 - sessionId: {}, result: {}", request.getSessionId(), templateSessionId);
        return ResponseUtil.successResponse(templateSessionId);
    }

    /**
     * 分页查询会话模板列表
     * <p>
     * 支持按模板类型、关键字等条件查询模板列表。 该接口支持匿名访问，无需登录即可使用。
     * </p>
     *
     * @param request 查询请求，包含分页参数、筛选条件等
     * @return ResponseUtil 查询结果，包含分页数据和模板列表
     */
    @PostMapping("/page")
    public ResponseUtil<PageInfo<TemplateSessionQueryResponseDto>> queryTemplateSessions(
        @Parameter(description = "查询请求", required = true) @Valid @RequestBody TemplateSessionQueryRequestDto request) {

        log.info("开始查询会话模板列表 - request: {}", request);

        // 调用服务层查询模板列表，异常由全局异常处理器处理
        PageInfo<TemplateSessionQueryResponseDto> result = templateSessionService.queryTemplateSessions(request);

        log.info("会话模板列表查询成功 - 总数: {}", result != null ? result.getTotal() : 0);
        return ResponseUtil.successResponse(result);
    }

    /**
     * 根据会话ID查询模板详情
     * <p>
     * 获取指定会话的模板详情信息，包括会话信息、模板扩展信息和聊天记录。 只有平台管理员才能执行此操作。
     * </p>
     *
     * @param request 查询请求
     * @return ResponseUtil 模板详情
     */
    @PostMapping("/getTemplateSessionDetail")
    public ResponseUtil<TemplateSessionDetailResponseDto> getTemplateSessionDetail(
        @Parameter(description = "查询请求", required = true) @Valid @RequestBody TemplateSessionDetailRequestDto request) {

        log.info("开始查询会话模板详情 - sessionId: {}, userId: {}", request.getSessionId(),
            CurrentUserHolder.getCurrentUserId());

        // 调用服务层查询模板详情，异常由全局异常处理器处理
        TemplateSessionDetailResponseDto result = templateSessionService
            .getTemplateSessionDetail(request.getSessionId());

        log.info("会话模板详情查询成功 - sessionId: {}", request.getSessionId());
        return ResponseUtil.successResponse(result);
    }

    /**
     * 编辑会话模板消息
     * <p>
     * 编辑指定会话模板中的消息内容。 只有平台管理员才能执行此操作。
     * </p>
     *
     * @param request 编辑请求
     * @return ResponseUtil 编辑结果
     */
    @PostMapping("/editTemplateMessage")
    public ResponseUtil<String> editTemplateMessage(
        @Parameter(description = "编辑请求", required = true) @Valid @RequestBody TemplateMessageEditRequestDto request) {

        log.info("开始编辑会话模板消息 - userId: {}, request: {}", CurrentUserHolder.getCurrentUserId(), request);

        // 调用服务层编辑模板消息，异常由全局异常处理器处理
        templateSessionService.editTemplateMessage(request.getSessionId(), request);

        return ResponseUtil.successResponse();
    }

    /**
     * 删除会话模板
     * <p>
     * 删除指定的会话模板，包括模板基本信息、消息、成员和成果空间数据。 只有平台管理员才能执行此操作。
     * </p>
     *
     * @param sessionId 模板会话ID
     * @return ResponseUtil 删除结果
     */
    @PostMapping("/deleteTemplateSession")
    public ResponseUtil<String> deleteTemplateSession(
        @Parameter(description = "模板会话ID", required = true) @RequestBody Long sessionId) {

        log.info("开始删除会话模板 - sessionId: {}, userId: {}", sessionId, CurrentUserHolder.getCurrentUserId());

        // 调用服务层删除模板会话，异常由全局异常处理器处理
        String result = templateSessionService.deleteTemplateSession(sessionId);

        log.info("会话模板删除成功 - sessionId: {}, result: {}", sessionId, result);
        return ResponseUtil.successResponse(result);
    }

    /**
     * 查询模板类型,对外开放接口 byai_system_config_list
     *
     * @return ResponseUtil
     */
    @PostMapping("/getTemplateTypes")
    public ResponseUtil<List<ByaiSystemConfigList>> getTemplateTypes() {
        List<ByaiSystemConfigList> byaiSystemConfigs = byaiSystemConfigService.findByParamGroupCode("TEMPLATE_TYPE");
        return ResponseUtil.successResponse(byaiSystemConfigs);
    }

}
