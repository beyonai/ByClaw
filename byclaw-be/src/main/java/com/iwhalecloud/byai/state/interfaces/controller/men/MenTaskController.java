package com.iwhalecloud.byai.state.interfaces.controller.men;

import com.iwhalecloud.byai.manager.dto.men.MenResComQueryQo;
import com.iwhalecloud.byai.manager.dto.men.MenTaskSessionQo;
import com.iwhalecloud.byai.manager.entity.men.MenResCom;
import com.iwhalecloud.byai.manager.entity.men.MenTask;
import com.iwhalecloud.byai.manager.qo.men.MenTaskQueryQo;
import com.iwhalecloud.byai.state.domain.men.enums.MenTaskStatusEnum;
import com.iwhalecloud.byai.manager.qo.men.MenResComQo;
import com.iwhalecloud.byai.state.domain.men.service.MenResComService;
import com.iwhalecloud.byai.state.domain.men.service.MenTaskService;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Arrays;

/**
 * 待办任务控制器
 */
@RestController
@RequestMapping("/menTaskController")
@Tag(name = "MenTaskController", description = "待办任务相关接口")
public class MenTaskController {

    @Autowired
    private MenTaskService menTaskService;

    @Autowired
    private MenResComService menResComService;

    /**
     * 分页查询待办任务列表
     * 
     * @param queryQo 查询参数，支持多条件和分页
     * @return 分页结果
     */
    @PostMapping("/listTasksByPage")
    @Operation(summary = "分页查询待办任务列表")
    public ResponseUtil listTasksByPage(@RequestBody MenTaskQueryQo queryQo) {
        if (StringUtils.isEmpty(queryQo.getTaskHandleType())) {
            return ResponseUtil.fail(I18nUtil.get("error.mentask.taskhandletype.required"));
        }
        return ResponseUtil.successResponse(menTaskService.listTasksByPage(queryQo));
    }

    /**
     * 修改任务信息（处理人、处理描述、处理类型、状态等）
     * 
     * @param updateQo 修改参数
     * @return 操作结果
     */
    @PostMapping("/updateTask")
    @Operation(summary = "修改任务信息")
    public ResponseUtil updateTask(@RequestBody MenTask updateQo) {
        if (StringUtils.isEmpty(updateQo.getStatusCd())) {
            return ResponseUtil.fail(I18nUtil.get("error.mentask.statuscd.required"));
        }
        // 如果是外部系统修改，taskId为空，必须校验taskExtId和systemNo
        if (updateQo.getTaskId() == null) {
            if (StringUtils.isEmpty(updateQo.getTaskExtId()) || StringUtils.isEmpty(updateQo.getSystemNo())) {
                return ResponseUtil.fail(I18nUtil.get("error.mentask.taskextid.systemno.required"));
            }
        }
        // 检查状态字段是否有效
        if (null != updateQo.getStatusCd() && !MenTaskStatusEnum.isValid(updateQo.getStatusCd())) {
            return ResponseUtil.fail("statisCd is incorrect");
        }
        return menTaskService.updateTask(updateQo);
    }

    /**
     * 修改资源组件
     * 
     * @param menResComDto 修改参数
     * @return 操作结果
     */
    @PostMapping("/updateResCom")
    @Operation(summary = "修改资源组件")
    public ResponseUtil updateResCom(@RequestBody MenResComQo menResComDto) {
        if (menResComDto.getResComId() == null || StringUtils.isEmpty(menResComDto.getResPage())) {
            return ResponseUtil.fail(I18nUtil.get("error.mentask.rescomid.respage.required"));
        }
        return menTaskService.updateResCom(menResComDto);
    }

    /**
     * 创建待办的会话
     * 
     * @param taskSessionQo 修改参数
     * @return 操作结果
     */
    @PostMapping("/createTaskConversation")
    @Operation(summary = "创建待办的会话")
    public ResponseUtil createTaskConversation(@RequestBody MenTaskSessionQo taskSessionQo) {
        if (taskSessionQo.getTaskId() == null) {
            return ResponseUtil.fail("taskId not empty");
        }
        return menTaskService.createTaskConversation(taskSessionQo);
    }

    /**
     * 获取资源组件
     * 
     * @param menResCom 修改参数
     * @return 操作结果
     */
    @PostMapping("/getResCom")
    @Operation(summary = "获取资源组件")
    public ResponseUtil getResCom(@RequestBody MenResCom menResCom) {
        if (menResCom.getResComId() == null) {
            return ResponseUtil.fail(I18nUtil.get("error.mentask.rescomid.required"));
        }
        return ResponseUtil.successResponse(menResComService.getRecCom(menResCom.getResComId()));
    }

    /**
     * 分页查询会话任务列表
     * 
     * @param queryQo 查询参数，支持多条件和分页
     * @return 分页结果
     */
    @PostMapping("/listTasksBySessionPage")
    @Operation(summary = "分页查询会话任务列表")
    public ResponseUtil listTasksBySessionPage(@RequestBody MenTaskQueryQo queryQo) {
        if (null == queryQo.getSessionId() && null == queryQo.getPTaskId()) {
            return ResponseUtil.fail("sessionId or pTaskId not empty");
        }
        return ResponseUtil.successResponse(menTaskService.listTasksByPage(queryQo));
    }

    /**
     * 批量获取资源组件
     * 
     * @param batchQueryQo 批量查询参数
     * @return 操作结果
     */
    @PostMapping("/getResComList")
    @Operation(summary = "批量获取资源组件")
    public ResponseUtil getResComList(@RequestBody MenResComQueryQo batchQueryQo) {
        if (CollectionUtils.isEmpty(batchQueryQo.getResComIds())) {
            return ResponseUtil.fail("resComIds not empty");
        }
        return ResponseUtil.successResponse(menResComService.getResComBatch(batchQueryQo.getResComIds()));
    }

    /**
     * 工作空间根据父任务查询待办
     */
    @PostMapping("/listTasksByPTask")
    @Operation(summary = "工作空间根据父任务查询待办")
    public ResponseUtil listTasksByPTask(@RequestBody MenTaskQueryQo approvalQo) {
        approvalQo
            .setStatusCdList(Arrays.asList(MenTaskStatusEnum.SUBMITTED.getCode(), MenTaskStatusEnum.WORKING.getCode(),
                MenTaskStatusEnum.INPUTREQUIRED.getCode(), MenTaskStatusEnum.COMPLETED.getCode()));
        return ResponseUtil.successResponse(menTaskService.listTasksByPTask(approvalQo));
    }

}