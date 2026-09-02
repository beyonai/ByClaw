package com.iwhalecloud.byai.manager.interfaces.controller.capability;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.iwhalecloud.byai.manager.application.service.capability.AgentCapabilityCardApplicationService;
import com.iwhalecloud.byai.manager.dto.capability.AgentCapabilityCompileInput;
import com.iwhalecloud.byai.manager.dto.capability.AgentCapabilityCompileResult;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;

import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import lombok.extern.slf4j.Slf4j;

/**
 * Agent 能力卡接口；自 byclaw-super 迁移至 byclaw-be，语义保持一致：
 * <ul>
 *   <li>POST /agent-capability-cards/compile —— 仅编译，不落库；</li>
 *   <li>PUT  /agents/{agentId}/capability-card —— 编译并 upsert 能力卡快照。</li>
 * </ul>
 *
 * @author tangs
 */
@Slf4j
@Api(tags = "Agent 能力卡")
@RestController
@RequestMapping("/agent-capability-cards")
public class AgentCapabilityCardController {

    @Autowired
    private AgentCapabilityCardApplicationService agentCapabilityCardApplicationService;

    /**
     * 仅编译能力卡，不落库。
     *
     * @param input 编译输入
     * @return 编译产物
     */
    @ApiOperation("编译 Agent 能力卡")
    @PostMapping("/compile")
    public ResponseUtil<AgentCapabilityCompileResult> compile(@RequestBody AgentCapabilityCompileInput input) {
        return ResponseUtil.successResponse(agentCapabilityCardApplicationService.compile(input));
    }

    /**
     * 编译并保存能力卡。systemCode 自动取自 ss_resource。
     *
     * @param agentId Agent 资源标识
     * @param input   编译输入
     * @return 编译产物
     */
    @ApiOperation("编译并保存 Agent 能力卡")
    @PutMapping("/{agentId}")
    public ResponseUtil<AgentCapabilityCompileResult> upsert(@PathVariable("agentId") Long agentId,
        @RequestBody AgentCapabilityCompileInput input) {
        return ResponseUtil.successResponse(
            agentCapabilityCardApplicationService.compileAndUpsert(agentId, input));
    }
}
