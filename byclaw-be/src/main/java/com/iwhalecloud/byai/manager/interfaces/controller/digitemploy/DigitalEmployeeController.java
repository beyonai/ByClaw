package com.iwhalecloud.byai.manager.interfaces.controller.digitemploy;

import java.io.OutputStream;
import java.util.List;
import java.util.Map;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.gateway.channels.service.ChannelService;
import com.iwhalecloud.byai.gateway.channels.service.ChannelServiceFactory;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceCatalogService;
import com.iwhalecloud.byai.manager.dto.resource.ResourceQueryRequest;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceCatalog;
import com.iwhalecloud.byai.manager.qo.organization.CatalogQo;
import com.iwhalecloud.byai.common.feign.response.python.EmployeeAuditResult;
import com.iwhalecloud.byai.manager.qo.resource.AgentListQo;
import com.iwhalecloud.byai.manager.vo.digitemploy.DebugSessionCleanupVo;
import com.iwhalecloud.byai.manager.vo.digitemploy.DebugSessionVo;
import com.iwhalecloud.byai.manager.vo.digitemploy.SetDefaultDigitalEmployeeResultVo;
import com.iwhalecloud.byai.manager.vo.resource.DigitalEmployeePageVo;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.template.enums.DebugModeEnum;
import com.iwhalecloud.byai.state.infrastructure.utils.CompletionsUtils;
import io.swagger.v3.oas.annotations.Parameter;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
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
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeApplicationService;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDetailsDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.EmployeeIdDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.SetDefaultDigitalEmployeeDTO;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.qo.resource.DigitalEmployeeQo;
import com.iwhalecloud.byai.common.annotation.ManageLogAnnotation;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.vo.resource.DigitalEmployeeVo;

/**
 * 数字员工的查询，编辑，创建，对话的控制器
 */
@RestController
@RequestMapping("/digitalEmployeeController")
public class DigitalEmployeeController {

    private static final Logger logger = LoggerFactory.getLogger(DigitalEmployeeController.class);

    @Autowired
    private SsResourceCatalogService ssResourceCatalogService;

    @Autowired
    private DigitalEmployeeApplicationService digitalEmployeeApplicationService;

    /**
     * 查询列表
     *
     * @param qo 查询对象
     * @return ResponseUtil
     */
    @RequestMapping(value = "/selectDigitalEmployeeByQo", method = RequestMethod.POST)
    public ResponseUtil<PageInfo<DigitalEmployeePageVo>> selectDigitalEmployeeByQo(@RequestBody DigitalEmployeeQo qo) {
        PageInfo<DigitalEmployeePageVo> pageVO = digitalEmployeeApplicationService.selectDigitalEmployeeByQo(qo);
        return ResponseUtil.successResponse(I18nUtil.get("digemployee.list.query.success"), pageVO);
    }

    /**
     * 给知识前端使用的通用数字员工列表查询。 当前端未传状态字段时，默认： publishType = publish publishStatus = 2 且不限定 ownerType / owner 视角。
     */
    @RequestMapping(value = "/queryAllDigitalEmployeeList", method = RequestMethod.POST)
    public ResponseUtil<PageInfo<DigitalEmployeeVo>> queryAllDigitalEmployeeList(
        @RequestBody DigitalEmployeeQo employeeQo) {
        PageInfo<DigitalEmployeeVo> pageVO = digitalEmployeeApplicationService.queryAllDigitalEmployeeList(employeeQo);
        return ResponseUtil.successResponse(I18nUtil.get("digemployee.all.list.query.success"), pageVO);
    }

    /**
     * 创建数字员工
     *
     * @param digitalEmployeeDTO 数字员工
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "数字员工", description = "创建数字员工")
    @RequestMapping(value = "/saveDigitalEmployee", method = RequestMethod.POST)
    public ResponseUtil<DigitalEmployeeDetailsDTO> saveDigitalEmployee(@RequestBody DigitalEmployeeDTO digitalEmployeeDTO) {

        SsResource ssResource = digitalEmployeeApplicationService.saveDigitalEmployee(digitalEmployeeDTO);

        // 同步openClaw工作空间
        digitalEmployeeApplicationService.synOpenClawWorkSpace(ssResource.getResourceId());

        EmployeeIdDTO employeeIdDTO = new EmployeeIdDTO();
        employeeIdDTO.setResourceId(ssResource.getResourceId());
        DigitalEmployeeDetailsDTO details = digitalEmployeeApplicationService.findDetailsById(employeeIdDTO);

        return ResponseUtil.successResponse(I18nUtil.get("digemployee.save.success"), details);
    }

    /**
     * 更新数字员工
     *
     * @param digitalEmployeeDTO 更新对象
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "数字员工", description = "更新数字员工")
    @RequestMapping(value = "/updateDigitalEmployee", method = RequestMethod.POST)
    public ResponseUtil<DigitalEmployeeDetailsDTO> updateDigitalEmployee(@RequestBody DigitalEmployeeDTO digitalEmployeeDTO) {

        SsResource ssResource = digitalEmployeeApplicationService.updateDigitalEmployee(digitalEmployeeDTO);

        // 同步openClaw工作空间
        digitalEmployeeApplicationService.synOpenClawWorkSpace(ssResource.getResourceId());

        EmployeeIdDTO employeeIdDTO = new EmployeeIdDTO();
        employeeIdDTO.setResourceId(ssResource.getResourceId());
        DigitalEmployeeDetailsDTO details = digitalEmployeeApplicationService.findDetailsById(employeeIdDTO);

        return ResponseUtil.successResponse(I18nUtil.get("digemployee.update.success"), details);
    }

    /**
     * 设置默认数字员工
     *
     * @param dto 请求参数
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "数字员工", description = "设置默认数字员工")
    @PostMapping("/setDefaultDigitalEmployee")
    public ResponseUtil<SetDefaultDigitalEmployeeResultVo> setDefaultDigitalEmployee(
        @Valid @RequestBody SetDefaultDigitalEmployeeDTO dto) {
        SetDefaultDigitalEmployeeResultVo result = digitalEmployeeApplicationService.setDefaultDigitalEmployee(dto);
        return ResponseUtil.successResponse(I18nUtil.get("digemployee.default.set.success"), result);
    }

    /***
     * 删除数字员工
     *
     * @param employeeIdDTO 删除标识
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "数字员工", description = "更新数字员工")
    @RequestMapping(value = "/deleteDigitalEmployee", method = RequestMethod.POST)
    public ResponseUtil<String> deleteDigitalEmployee(@RequestBody EmployeeIdDTO employeeIdDTO) {

        digitalEmployeeApplicationService.deleteDigitalEmployee(employeeIdDTO);

        return ResponseUtil.success(I18nUtil.get("digemployee.delete.success"));
    }

    /**
     * 检查数字员工
     *
     * @param digitalEmployeeDTO 数字员工
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "数字员工", description = "检查数字员工参数")
    @RequestMapping(value = "/checkEmployeeAudit", method = RequestMethod.POST)
    public ResponseUtil checkEmployeeAudit(@RequestBody DigitalEmployeeDTO digitalEmployeeDTO) {
        List<EmployeeAuditResult> result = digitalEmployeeApplicationService.checkEmployeeAudit(digitalEmployeeDTO);
        return ResponseUtil.successResponse(I18nUtil.get("digemployee.audit.check.success"), result);
    }

    /***
     * 查询数字员工详情
     *
     * @param employeeIdDTO 入参
     * @return ResponseUtil
     */
    @RequestMapping(value = "/findDetailsById", method = RequestMethod.POST)
    public ResponseUtil findDetailsById(@RequestBody EmployeeIdDTO employeeIdDTO) {
        DigitalEmployeeDetailsDTO digEmployeeDetails = digitalEmployeeApplicationService.findDetailsById(employeeIdDTO);
        return ResponseUtil.successResponse(I18nUtil.get("digemployee.detail.query.success"), digEmployeeDetails);
    }

    /***
     * 查询数字员工详情
     *
     * @param employeeIdDTO 入参
     * @return ResponseUtil
     */
    @RequestMapping(value = "/queryRelResourceInfo", method = RequestMethod.POST)
    public ResponseUtil queryRelResourceInfo(@RequestBody DigitalEmployeeDetailsDTO employeeIdDTO) {
        return digitalEmployeeApplicationService.queryRelResourceInfo(employeeIdDTO);
    }

    /**
     * 查询技能目录树
     *
     * @param catalogQo 查询对象
     * @return ResponseUtil
     */
    @PostMapping("/queryCatalogTree")
    public ResponseUtil<List<SsResourceCatalog>> queryCatalogTree(@RequestBody CatalogQo catalogQo) {
        List<SsResourceCatalog> result = ssResourceCatalogService.queryCatalogTree(catalogQo);
        return ResponseUtil.successResponse(I18nUtil.get("digemployee.catalog.tree.query.success"), result);
    }

    /**
     * 数字员工发布检查
     */
    @PostMapping("/checkDigitalEmployeePublish")
    public ResponseUtil<List<EmployeeAuditResult>> checkDigitalEmployeePublish() {
        // 暂不实现
        return ResponseUtil.success(I18nUtil.get("digemployee.publish.check.success"));
    }

    /**
     * 数字员工一键完善
     *
     * @param promptInputMap 入参
     * @return ResponseUtil
     */
    @RequestMapping(value = "/v2/generate", method = RequestMethod.POST)
    public ResponseUtil<Map<String, Object>> generate(@RequestBody Map<String, Object> promptInputMap) {
        Map<String, Object> generateMap = digitalEmployeeApplicationService.generate(promptInputMap);
        return ResponseUtil.successResponse(I18nUtil.get("digemployee.generate.success"), generateMap);
    }

    /**
     * 查询数字员工调整试会话信息
     *
     * @param agentId 数据员工标识
     * @return ResponseUtil
     */
    @GetMapping(value = "/debugSession")
    public ResponseUtil<DebugSessionVo> debugSession(@RequestParam("agentId") Long agentId) {
        DebugSessionVo debugSessionVo = digitalEmployeeApplicationService.debugSession(agentId);
        return ResponseUtil.successResponse(I18nUtil.get("digemployee.debug.session.query.success"), debugSessionVo);
    }

    /**
     * 数字员工调试接口
     *
     * @param response 响应头
     * @param assistantChatDto 入参
     */
    @PostMapping("/debugChat")
    public void debugChat(HttpServletResponse response, @RequestBody AssistantChatDto assistantChatDto) {

        try (OutputStream outputStream = response.getOutputStream()) {

            // 设置为调试模式
            assistantChatDto.setIsDebug(DebugModeEnum.DEBUG_1.getNum());

            CompletionsUtils.setResHeader(response, true);

            // 根据 accessTerminal 从工厂获取对应的渠道服务
            String accessTerminal = assistantChatDto.getAccessTerminal();
            logger.info("对话请求，渠道类型: {}", accessTerminal);
            ChannelService channelService = ChannelServiceFactory.getService(accessTerminal);

            // 验证请求
            if (!channelService.validateRequest(assistantChatDto)) {
                throw new BaseException(I18nUtil.get("assistant.chat.request.invalid"));
            }

            // 调用渠道服务的 chat 方法
            channelService.chat(assistantChatDto, outputStream);
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
            throw new BaseException(I18nUtil.get("assistant.chat.network.busy"), e);
        }
    }

    @PostMapping("/getMessageList")
    public void getMessageList(HttpServletResponse response, @RequestBody AssistantChatDto assistantChatDto) {

        try (OutputStream outputStream = response.getOutputStream()) {

            // 设置为调试模式
            assistantChatDto.setIsDebug(DebugModeEnum.DEBUG_1.getNum());

            CompletionsUtils.setResHeader(response, true);

            // 根据 accessTerminal 从工厂获取对应的渠道服务
            String accessTerminal = assistantChatDto.getAccessTerminal();
            logger.info("对话请求，渠道类型: {}", accessTerminal);
            ChannelService channelService = ChannelServiceFactory.getService(accessTerminal);

            // 验证请求
            if (!channelService.validateRequest(assistantChatDto)) {
                throw new BaseException(I18nUtil.get("assistant.chat.request.invalid"));
            }

            // 调用渠道服务的 chat 方法
            channelService.chat(assistantChatDto, outputStream);
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
            throw new BaseException(I18nUtil.get("assistant.chat.network.busy"), e);
        }
    }

    /**
     * 根据defaultType查询数据
     *
     * @param agentListQo 查询对象
     * @return ResponseUtil
     */
    @PostMapping("/queryResourceListByDefaultType")
    public ResponseUtil<?> queryResourceListByDefaultType(@RequestBody AgentListQo agentListQo) {
        List<SsResource> ssResources = digitalEmployeeApplicationService.queryResourceListByDefaultType(agentListQo);
        return ResponseUtil.successResponse(I18nUtil.get("digemployee.default.resource.list.query.success"),
            ssResources);
    }

    /**
     * 资源状态数量统计
     */
    @PostMapping("/getStatusNumStatics")
    public ResponseUtil<?> getStatusNumStatics(@Valid @RequestBody ResourceQueryRequest request) {
        return ResponseUtil.successResponse(I18nUtil.get("digemployee.status.stats.query.success"),
            digitalEmployeeApplicationService.getStatusNumStatics(request));
    }

    /**
     * 根据会话ID清理调试消息接口
     *
     * @param sessionId 数字员工ID，用于标识需要清理调试消息的会话
     * @return 返回清理调试消息的结果响应）
     */
    @GetMapping("/cleanupDebugMessages")
    public ResponseUtil cleanupDebugMessages(
        @Parameter(description = "会话ID", required = true) @RequestParam("sessionId") Long sessionId) {
        DebugSessionCleanupVo response = digitalEmployeeApplicationService.cleanupDebugMessages(sessionId);
        return ResponseUtil.successResponse(response);
    }

}
