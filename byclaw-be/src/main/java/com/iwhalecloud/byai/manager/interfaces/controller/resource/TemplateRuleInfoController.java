package com.iwhalecloud.byai.manager.interfaces.controller.resource;

import com.iwhalecloud.byai.manager.application.service.template.TemplateRuleInfoApplicationService;
import com.iwhalecloud.byai.manager.dto.template.SceneOperationRequest;
import com.iwhalecloud.byai.manager.dto.template.TemplateRuleInfoCreateRequest;
import com.iwhalecloud.byai.manager.qo.template.TemplateRuleInfoQueryQo;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.annotation.ManageLogAnnotation;
import com.iwhalecloud.byai.common.page.PageInfo;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 模版规则信息控制器
 * 
 * @author system
 * &#064;date  2025-01-XX
 */
@Api(tags = "模版管理")
@RestController
@RequestMapping("/templateRuleInfo")
public class TemplateRuleInfoController {

    @Autowired
    private TemplateRuleInfoApplicationService templateRuleInfoApplicationService;

    /**
     * 新增模版接口
     * 
     * @param request 创建请求，包含rule_name、rule_content、resource_id、userId
     * @return ResponseUtil
     */
    @ApiOperation("新增模版")
    @ManageLogAnnotation(name = "模版管理", description = "新增模版")
    @PostMapping("/create")
    public ResponseUtil<?> createTemplateRuleInfo(@Valid @RequestBody TemplateRuleInfoCreateRequest request) {
        try {
            Long templateId = templateRuleInfoApplicationService.createTemplateRuleInfo(request);
            return ResponseUtil.successResponse("模版创建成功", templateId);
        } catch (Exception e) {
            return ResponseUtil.fail("创建场景失败: " + e.getMessage());
        }
    }

    /**
     * 模版信息查询接口
     * 支持template_id、user_id和resource_id精确查询
     * rule_name和rule_content模糊查询
     * 根据create_time和update_time时间段查询（起始时间和结束时间）
     * 
     * @param queryQo 查询条件
     * @return ResponseUtil
     */
    @ApiOperation("查询模版信息")
    @PostMapping("/query")
    public ResponseUtil<?> queryTemplateRuleInfo(@RequestBody TemplateRuleInfoQueryQo queryQo) {
        PageInfo<?> pageVO = templateRuleInfoApplicationService.queryTemplateRuleInfo(queryQo);
        return ResponseUtil.successResponse(pageVO);
    }

    /**
     * 删除场景接口
     * 删除该数字员工或超级助手关联的场景，涉及表 resource_template_relation 和 template_rule_info
     * 调用智能体的 Feign 删除场景接口
     * 
     * @param request 场景操作请求
     * @return ResponseUtil
     */
    @ApiOperation("删除场景")
    @ManageLogAnnotation(name = "模版管理", description = "删除场景")
    @PostMapping("/deleteScene")
    public ResponseUtil<?> deleteScene(@Valid @RequestBody SceneOperationRequest request) {
        try {
            templateRuleInfoApplicationService.deleteScene(request);
            return ResponseUtil.successResponse("删除场景成功");
        } catch (Exception e) {
            return ResponseUtil.fail("删除场景失败: " + e.getMessage());
        }
    }

    /**
     * 修改场景接口
     * 修改表 template_rule_info，调用智能体的接口保存场景（传入 sceneId 进行更新）
     * 
     * @param request 场景操作请求（包含 ruleName 和 ruleContent）
     * @return ResponseUtil
     */
    @ApiOperation("修改场景")
    @ManageLogAnnotation(name = "模版管理", description = "修改场景")
    @PostMapping("/updateScene")
    public ResponseUtil<?> updateScene(@Valid @RequestBody SceneOperationRequest request) {
        try {
            templateRuleInfoApplicationService.updateScene(request);
            return ResponseUtil.successResponse("修改场景成功");
        } catch (Exception e) {
            return ResponseUtil.fail("修改场景失败: " + e.getMessage());
        }
    }

    /**
     * 更新 resource_template_relation 表的 memory_rule_id 字段
     * 
     * @param request 更新请求（包含 templateId, resourceId, memoryRuleId）
     * @return ResponseUtil
     */
    @ApiOperation("更新资源模板关联关系的场景ID")
    @PostMapping("/updateMemoryRuleId")
    public ResponseUtil<?> updateResourceTemplateRelationMemoryRuleId(@RequestBody Map<String, Object> request) {
        try {
            templateRuleInfoApplicationService.updateResourceTemplateRelationMemoryRuleId(request);
            return ResponseUtil.successResponse("更新场景ID成功");
        } catch (Exception e) {
            return ResponseUtil.fail("更新场景ID失败: " + e.getMessage());
        }
    }
}

