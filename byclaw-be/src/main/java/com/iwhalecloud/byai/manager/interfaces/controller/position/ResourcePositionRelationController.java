package com.iwhalecloud.byai.manager.interfaces.controller.position;

import com.iwhalecloud.byai.manager.application.service.position.ResourcePositionRelationApplicationService;
import com.iwhalecloud.byai.manager.dto.position.ResourcePositionBindDTO;
import com.iwhalecloud.byai.manager.entity.position.ResourcePositionRelation;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtEvaluate;
import com.iwhalecloud.byai.manager.qo.position.PositionResourceSearchQO;
import com.iwhalecloud.byai.manager.qo.resource.SsResExtEvaluateQO;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.vo.position.PositionDigitalEmployeeVo;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;

/**
 * 数字岗位与数字员工关系控制器
 */
@RestController
@RequestMapping("/system/resourcePositionRelation")
@Validated
public class ResourcePositionRelationController {

    @Autowired
    private ResourcePositionRelationApplicationService resourcePositionRelationApplicationService;

    /**
     * 查询岗位下的数字员工信息（分页）
     *
     * @param searchQO 查询对象
     * @return PageInfo<PositionDigitalEmployeeVo>
     */
    @PostMapping("/searchResources")
    public ResponseUtil<PageInfo<PositionDigitalEmployeeVo>> searchResources(
        @Valid @RequestBody PositionResourceSearchQO searchQO) {
        PageInfo<PositionDigitalEmployeeVo> result = resourcePositionRelationApplicationService
            .searchPositionResources(searchQO);
        return ResponseUtil.successResponse(result);
    }

    /**
     * 添加数字员工绑定岗位
     *
     * @param request 绑定请求
     * @return ResponseUtil<ResourcePositionRelation>
     */
    @PostMapping("/bindPositionResource")
    public ResponseUtil<ResourcePositionRelation> bindPositionResource(
        @Valid @RequestBody ResourcePositionBindDTO request) {
        ResourcePositionRelation result = resourcePositionRelationApplicationService.bindPositionResource(request);
        return ResponseUtil.successResponse(result);
    }

    /**
     * 移除数字员工绑定岗位（解绑）
     */
    @PostMapping("/unbindPositionResource")
    public ResponseUtil<ResourcePositionRelation> unbindPositionResource(
        @Valid @RequestBody ResourcePositionBindDTO request) {
        ResourcePositionRelation result = resourcePositionRelationApplicationService.unbindPositionResource(request);
        return ResponseUtil.successResponse(result);
    }

    /**
     * 上岗操作
     *
     * @param request 上岗请求
     * @return ResponseUtil<ResourcePositionRelation>
     */
    @PostMapping("/onJob")
    public ResponseUtil<ResourcePositionRelation> onJob(@Valid @RequestBody ResourcePositionBindDTO request) {
        ResourcePositionRelation result = resourcePositionRelationApplicationService.onJob(request);
        return ResponseUtil.successResponse(result);
    }

    /**
     * 下岗操作
     *
     * @param request 下岗请求
     * @return ResponseUtil<ResourcePositionRelation>
     */
    @PostMapping("/offJob")
    public ResponseUtil<ResourcePositionRelation> offJob(@Valid @RequestBody ResourcePositionBindDTO request) {
        ResourcePositionRelation result = resourcePositionRelationApplicationService.offJob(request);
        return ResponseUtil.successResponse(result);
    }

    /**
     * 查询数字员工的评估结果分页
     *
     * @param evaluateQO 查询对象
     * @return PageInfo<SsResExtEvaluate>
     */
    @PostMapping("/evaluate/queryPage")
    public ResponseUtil<PageInfo<SsResExtEvaluate>> queryEvaluatePage(
        @Valid @RequestBody SsResExtEvaluateQO evaluateQO) {
        PageInfo<SsResExtEvaluate> result = resourcePositionRelationApplicationService.selectEvaluateByPage(evaluateQO);
        return ResponseUtil.successResponse(result);
    }

}
