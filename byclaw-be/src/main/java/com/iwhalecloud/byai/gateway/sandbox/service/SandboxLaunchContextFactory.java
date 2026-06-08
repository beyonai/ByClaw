package com.iwhalecloud.byai.gateway.sandbox.service;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.constants.resource.WorkerAgentType;
import com.iwhalecloud.byai.common.feign.response.knowledge.ModelDto;
import com.iwhalecloud.byai.common.jwt.JwtService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.manager.application.service.aimodel.ModelManagementApplicationService;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AiModelService;
import com.iwhalecloud.byai.manager.dto.resource.ResourceExtDigEmployeeDto;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.qo.resource.DigEmployeeExtQo;
import com.iwhalecloud.byai.state.domain.chat.dto.ModelInfoDto;
import com.iwhalecloud.byai.state.domain.chat.dto.PrologueDto;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;

/**
 * 构建沙箱启动所需的业务上下文。
 */
@Service
public class SandboxLaunchContextFactory {

    private static final Logger LOGGER = LoggerFactory.getLogger(SandboxLaunchContextFactory.class);

    @Value("${sandbox.model_provider_name:iwhalecloud}")
    private String modelProviderName;

    @Lazy
    @Autowired
    private SsResourceService ssResourceService;

    @Lazy
    @Autowired
    private AiModelService aiModelService;

    @Lazy
    @Autowired
    private ByaiSystemConfigService byaiSystemConfigService;

    @Lazy
    @Autowired
    private ModelManagementApplicationService modelManagementApplicationService;

    @Lazy
    @Autowired
    private JwtService jwtService;

    @Lazy
    @Autowired
    private LoginApplicationService loginApplicationService;

    @Lazy
    @Autowired
    private SsResExtDigEmployeeService ssResExtDigEmployeeService;

    @Lazy
    @Autowired
    private SandboxUserInfoFactory sandboxUserInfoFactory;

    @Lazy
    @Autowired
    private SandboxService sandboxService;

    /**
     * 根据 resourceId 解析沙箱路由。
     * 优先使用用户缓存的 serviceKey（当路由结果为默认类型时）。
     *
     * @param resourceId 资源ID
     * @param userCode   用户工号，用于查找缓存的首选 serviceKey
     * @return 沙箱启动路由
     */
    public SandboxLaunchRouting resolveRouting(Long resourceId, String userCode) {
        SandboxLaunchRouting routing = resolveRouting(resourceId);
        if (SandboxLaunchRouting.DEFAULT_SANDBOX_TYPE.equals(routing.getSandboxType())
            && StringUtils.isNotBlank(userCode)) {
            String preferred = sandboxService.getPreferredServiceKey(userCode);
            if (StringUtils.isNotBlank(preferred)) {
                LOGGER.info("使用用户缓存的 serviceKey: userCode={}, serviceKey={}", userCode, preferred);
                return new SandboxLaunchRouting(preferred, SandboxLaunchRouting.DEFAULT_RESOURCE_ID);
            }
        }
        return routing;
    }

    public SandboxLaunchRouting resolveRouting(Long resourceId) {
        if (resourceId == null || resourceId.equals(SandboxLaunchRouting.DEFAULT_RESOURCE_ID)) {
            return new SandboxLaunchRouting(SandboxLaunchRouting.DEFAULT_SANDBOX_TYPE,
                SandboxLaunchRouting.DEFAULT_RESOURCE_ID);
        }
        if (resourceId.equals(SandboxLaunchRouting.DEFAULT_CODE_AGENT_RESOURCE_ID)) {
            return new SandboxLaunchRouting(SandboxLaunchRouting.BYCLAW_CODE_AGENT_SANDBOX_TYPE,
                SandboxLaunchRouting.DEFAULT_CODE_AGENT_RESOURCE_ID);
        }
        try {
            SsResource ssResource = ssResourceService.findById(resourceId);
            String workerAgentType = ssResource != null ? ssResource.getWorkerAgentType() : null;
            if (StringUtils.startsWith(workerAgentType, WorkerAgentType.BYCLAW_CODE.getCode())) {
                LOGGER.info("资源ID：{} workerAgentType 为 {}，使用 byclaw-code-agent 沙箱", resourceId, workerAgentType);
                return new SandboxLaunchRouting(SandboxLaunchRouting.BYCLAW_CODE_AGENT_SANDBOX_TYPE,
                    SandboxLaunchRouting.DEFAULT_CODE_AGENT_RESOURCE_ID);
            }
        }
        catch (Exception e) {
            LOGGER.warn("查询资源 workerAgentType 异常，降级为默认沙箱类型，资源ID：{}，原因：{}", resourceId, e.getMessage());
        }
        // openclaw 是用户级沙箱，DB 活跃唯一键中的 resource_id 固定归一为 -1。
        return new SandboxLaunchRouting(SandboxLaunchRouting.DEFAULT_SANDBOX_TYPE,
            SandboxLaunchRouting.DEFAULT_RESOURCE_ID);
    }

    public SandboxLaunchContext buildContext(String userCode, Long resourceId, String sandboxType) {
        String gatewayToken = generateGatewayToken();
        Map<String, String> envs = buildSandboxEnvs(userCode, queryDigEmployee(resourceId), resourceId, gatewayToken);
        applySandboxAgentTypeEnv(envs, sandboxType, userCode);
        return new SandboxLaunchContext(sandboxType, envs, sandboxUserInfoFactory.build(userCode), gatewayToken);
    }

    private String generateGatewayToken() {
        return UUID.randomUUID().toString().replace("-", "");
    }

    private void applySandboxAgentTypeEnv(Map<String, String> envs, String sandboxType, String userCode) {
        if (!SandboxLaunchRouting.BYCLAW_CODE_AGENT_SANDBOX_TYPE.equals(sandboxType)) {
            return;
        }
        String agentType = WorkerAgentType.BYCLAW_CODE.getCode() + "_" + userCode;
        envs.put("agentType", agentType);
        envs.put("AGENT_TYPE", agentType);
        envs.put("TARGET_AGENT_TYPE", agentType);
        LOGGER.info("byclaw-code-agent 沙箱使用 agentType：{}", agentType);
    }

    private SsResExtDigEmployee queryDigEmployee(Long resourceId) {
        if (resourceId == null || resourceId.equals(SandboxLaunchRouting.DEFAULT_RESOURCE_ID)) {
            return buildDefaultDigEmployee();
        }
        try {
            DigEmployeeExtQo qo = new DigEmployeeExtQo();
            qo.setResourceId(resourceId);
            ResourceExtDigEmployeeDto extDto = ssResExtDigEmployeeService.findExtDigEmployeeByQo(qo);
            if (extDto != null) {
                return extDto.getSsResExtDigEmployee();
            }
        }
        catch (Exception e) {
            LOGGER.error("查询数字员工扩展信息异常，资源ID：{}", resourceId, e);
        }
        return null;
    }

    private SsResExtDigEmployee buildDefaultDigEmployee() {
        SsResExtDigEmployee digEmployee = new SsResExtDigEmployee();
        digEmployee.setAgentDevType(SandboxLaunchRouting.DEFAULT_SANDBOX_TYPE);

        try {
            String defaultModelId = modelManagementApplicationService.getDefaultModelId();
            if (StringUtils.isNotBlank(defaultModelId)) {
                long modelIdValue = Long.parseLong(defaultModelId);
                ModelInfoDto modelInfoDto = new ModelInfoDto();
                modelInfoDto.setModelId(modelIdValue);

                PrologueDto prologueDto = new PrologueDto();
                prologueDto.setModelId(modelIdValue);
                prologueDto.setModelInfo(modelInfoDto);

                digEmployee.setPrologue(JSON.toJSONString(prologueDto));
                LOGGER.info("resourceId为null，构造默认数字员工信息，agentDevType=openclaw，defaultModelId={}", defaultModelId);
            }
            else {
                LOGGER.warn("resourceId为null且无法获取默认模型ID，prologue将为空");
            }
        }
        catch (Exception e) {
            LOGGER.error("构造默认数字员工信息时获取默认模型ID异常", e);
        }

        return digEmployee;
    }

    private Map<String, String> buildSandboxEnvs(String userCode, SsResExtDigEmployee digEmployee, Long resourceId,
        String gatewayToken) {
        Map<String, String> envs = new HashMap<>(8);

        loadEnvFile(envs);
        envs.put("gateway_token", gatewayToken);
        envs.put("OPENCLAW_GATEWAY_TOKEN", gatewayToken);
        applyCurrentUserAuthEnv(envs, userCode);

        if (digEmployee == null || StringUtils.isBlank(digEmployee.getPrologue())) {
            LOGGER.warn("资源ID：{} 的prologue为空，无法构建模型环境变量", resourceId);
            return envs;
        }

        try {
            PrologueDto prologueDto = JSON.parseObject(digEmployee.getPrologue(), PrologueDto.class);
            Long modelId = extractModelId(prologueDto);

            if (modelId == null) {
                LOGGER.warn("资源ID：{} 的prologue中未找到modelId", resourceId);
                return envs;
            }

            ModelDto modelDto = aiModelService.getModel(String.valueOf(modelId));
            if (modelDto == null) {
                LOGGER.warn("未查询到模型信息，资源ID：{}，modelId：{}", resourceId, modelId);
                return envs;
            }

            if (StringUtils.isNotBlank(modelDto.getUrl())) {
                envs.put("model_base_url", modelDto.getUrl());
                envs.put("MODEL_BASE_URL", modelDto.getUrl());
            }
            if (StringUtils.isNotBlank(modelDto.getModelCode())) {
                envs.put("model_name", modelDto.getModelCode());
                envs.put("MODEL_ID", modelDto.getModelCode());
                envs.put("MODEL_NAME", modelDto.getModelCode());
                envs.put("MODEL_ALIAS", modelDto.getModelCode());
            }
            if (StringUtils.isNotBlank(modelDto.getAuthToken())) {
                envs.put("model_api_key", modelDto.getAuthToken());
                envs.put("MODEL_API_KEY", modelDto.getAuthToken());
            }
            String bearer = byaiSystemConfigService.getDcSystemConfigValueByCode("AUTHORIZATION_BEARER");
            if (StringUtil.isNotEmpty(bearer)) {
                envs.put("BAIYING_AGENT_AUTH", "Bearer ".concat(bearer));
            }
            envs.put("MODEL_PROVIDER_NAME", modelProviderName);
            envs.put("NODE_OPTIONS", "--max-old-space-size=4096");

            LOGGER.info("沙箱环境变量构建完成，资源ID：{}，modelId：{}，model_name：{}", resourceId, modelId, modelDto.getModelCode());
        }
        catch (Exception e) {
            LOGGER.error("构建沙箱环境变量异常，资源ID：{}", resourceId, e);
        }

        return envs;
    }

    private void applyCurrentUserAuthEnv(Map<String, String> envs, String userCode) {
        if (StringUtils.isBlank(userCode)) {
            return;
        }

        envs.put("USER_CODE", userCode);

        String sessionId = CurrentUserHolder.getSessionId();
        if (StringUtils.isNotBlank(sessionId)) {
            envs.put("BAIYING_SESSION", sessionId);
        }

        try {
            if (jwtService != null && loginApplicationService != null) {
                String beyondToken = jwtService.createJwt(loginApplicationService.getLoginInfo(userCode));
                if (StringUtils.isNotBlank(beyondToken)) {
                    envs.put("BEYOND_TOKEN", beyondToken);
                }
            }
        }
        catch (Exception e) {
            LOGGER.warn("构建沙箱 Beyond-Token 异常，userCode：{}，原因：{}", userCode, e.getMessage());
        }
    }

    private void loadEnvFile(Map<String, String> envs) {
        System.getenv().forEach((key, value) -> {
            if (StringUtils.isNotBlank(value)) {
                envs.put(key, value);
            }
        });
        System.getProperties().forEach((key, value) -> {
            String k = String.valueOf(key);
            String v = String.valueOf(value);
            if (!envs.containsKey(k) && StringUtils.isNotBlank(v)) {
                envs.put(k, v);
            }
        });
        LOGGER.debug("从环境变量和系统属性加载了沙箱环境变量：{}", envs);
    }

    private Long extractModelId(PrologueDto prologueDto) {
        if (prologueDto == null) {
            return null;
        }
        if (prologueDto.getModelInfo() != null && prologueDto.getModelInfo().getModelId() != null) {
            return prologueDto.getModelInfo().getModelId();
        }
        return prologueDto.getModelId();
    }

}
