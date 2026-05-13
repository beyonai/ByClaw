package com.iwhalecloud.byai.manager.interfaces.controller.operations;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import com.iwhalecloud.byai.manager.application.service.operations.OperationsDigEmployeeService;
import com.iwhalecloud.byai.manager.dto.operations.MessageRelObjMetricsRequest;
import com.iwhalecloud.byai.manager.dto.operations.OperationResourceIdRequest;
import com.iwhalecloud.byai.manager.dto.operations.MessageFeedbackAssignRequest;
import com.iwhalecloud.byai.manager.dto.operations.ApplyPostRequest;
import com.iwhalecloud.byai.manager.dto.operations.OperationResourceTestSetRequest;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtTestSet;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.vo.operations.DigEmployeeOperationsVO;
import com.iwhalecloud.byai.manager.vo.resource.SsResExtEvaluateCompareVO;
import com.iwhalecloud.byai.manager.qo.resource.SsResExtTestSetQo;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.vo.resource.SsResExtTestSetVo;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.util.CollectionUtils;
import org.springframework.util.StringUtils;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.multipart.MultipartFile;

import java.util.Map;

/**
 * 数字员工运营数据分析接口
 *
 * @author zzh
 */
@Tag(name = "数字员工运营数据分析", description = "数字员工运营数据分析相关接口")
@RestController
@RequestMapping("/operations/digEmployee")
@Validated
public class OperationsDigEmployeeController {

    @Autowired
    private OperationsDigEmployeeService operationsDigEmployeeService;

    /**
     * 获取数字员工运营信息 包括基本信息、技能列表和知识库列表
     *
     * @param resourceId 数字员工资源ID
     * @return 数字员工运营信息
     */
    @Operation(summary = "获取数字员工运营基础信息", description = "根据资源ID获取数字员工的基本信息、技能列表和知识库列表")
    @GetMapping("/getOperationsInfo")
    public ResponseUtil<DigEmployeeOperationsVO> getOperationsInfo(
        @Parameter(description = "数字员工资源ID", required = true) @RequestParam("resourceId") Long resourceId) {
        if (resourceId == null) {
            return ResponseUtil.failRes(I18nUtil.get("operations.digemployee.resource.id.not.null"));
        }
        DigEmployeeOperationsVO result = operationsDigEmployeeService.getDigEmployeeOperationsInfo(resourceId);
        return ResponseUtil.successRes(result);
    }

    /**
     * 获取数字员工运营信息 - 使用指标 包括点赞量、点踩量、服务总次数、服务总人数、人均对话次数及其趋势
     *
     * @param request 指标请求参数
     * @return 使用指标响应
     */
    @Operation(summary = "获取数字员工运营信息 - 使用指标/技术性指标",
        description = "根据查询编码和时间范围获取数字员工的使用指标，包括点赞量、点踩量、服务总次数、服务总人数、人均对话次数及其趋势"
            + "或 数字员工的技术性指标，包括平均首词响应时长、平均回复时长、对话异常率及其趋势")
    @PostMapping("/getMetrics")
    public ResponseUtil<Map<String, Object>> getDigEmployeeMetrics(@RequestBody MessageRelObjMetricsRequest request) {
        if (request == null || !StringUtils.hasText(request.getQueryCode())) {
            return ResponseUtil.failRes(I18nUtil.get("operations.query.code.not.null"));
        }
        Map<String, Object> result = operationsDigEmployeeService.getDigEmployeeMetrics(request);
        return ResponseUtil.successRes(result);
    }

    @Operation(summary = "获取数字员工评估详情结果", description = "根据数字员工的资源ID获取数字员工评估详情结果")
    @PostMapping("/getEvaluateDetail")
    public ResponseUtil<SsResExtEvaluateCompareVO> getEvaluateDetail(
        @RequestBody @Valid OperationResourceIdRequest request) {
        SsResExtEvaluateCompareVO result = operationsDigEmployeeService.getEvaluateDetail(request.getResourceId());
        return ResponseUtil.successRes(result);
    }

    @Operation(summary = "立即评估", description = "根据数字员工的资源ID立即评估")
    @PostMapping("/immediatelyEvaluate")
    public ResponseUtil<SsResExtEvaluateCompareVO> immediatelyEvaluate(
        @RequestBody @Valid OperationResourceIdRequest request) {
        SsResExtEvaluateCompareVO result = operationsDigEmployeeService.immediatelyEvaluate(request.getResourceId());
        return ResponseUtil.successRes(result);
    }

    @Operation(summary = "上传测试集", description = "根据数字员工的资源ID上传测试集")
    @PostMapping("/uploadTestSet")
    public ResponseUtil<SsResExtTestSet> uploadTestSet(
        @RequestParam("resourceId") @JsonSerialize(using = ToStringSerializer.class) Long resourceId,
        @RequestParam("file") MultipartFile file) {
        if (resourceId == null) {
            return ResponseUtil.failRes(I18nUtil.get("operations.digemployee.resource.id.not.null"));
        }
        if (file == null) {
            return ResponseUtil.failRes(I18nUtil.get("operations.digemployee.test.set.file.not.null"));
        }
        SsResExtTestSet result = operationsDigEmployeeService.uploadTestSet(resourceId, file);
        return ResponseUtil.successRes(result);
    }

    @Operation(summary = "获取测试集批次结果", description = "根据数字员工的资源ID获取测试集批次结果")
    @PostMapping("/getTestSetResult")
    public ResponseUtil<SsResExtTestSet> getTestSetResult(@RequestBody @Valid OperationResourceTestSetRequest request) {
        SsResExtTestSet result = operationsDigEmployeeService.getTestSetResult(request);
        return ResponseUtil.successRes(result);
    }

    @Operation(summary = "获取资源ID的所有测试集批次结果(分页)", description = "获取资源ID的测试集批次结果")
    @PostMapping("/getTestSetResultPage")
    public ResponseUtil<PageInfo<SsResExtTestSetVo>> getTestSetResultPage(
        @RequestBody @Valid SsResExtTestSetQo testSetQo) {
        if (testSetQo == null) {
            return ResponseUtil.failRes(I18nUtil.get("operations.request.param.not.null"));
        }
        PageInfo<SsResExtTestSetVo> result = operationsDigEmployeeService.getTestSetResultPage(testSetQo);
        return ResponseUtil.successRes(result);
    }

}
