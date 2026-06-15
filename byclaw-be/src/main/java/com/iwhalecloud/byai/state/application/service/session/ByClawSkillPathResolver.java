package com.iwhalecloud.byai.state.application.service.session;

import java.util.Collections;
import java.util.List;
import java.util.Locale;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.staticdata.service.SystemConfigService;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * byclaw skill 根路径解析器。
 *
 * <p>默认路径仍保持历史规则；当参数管理 TEMPLATE_DIGITAL_EMPLOYEE 配置了对应 agentType + ownerType
 * 的 skillPath 时，优先使用配置路径，便于问答/问数等不同数字员工类型落到不同工作空间。</p>
 *
 * @author qin.guoquan
 * @date 2026-06-01 15:38:38
 */
@Service
public class ByClawSkillPathResolver {

    private static final Logger logger = LoggerFactory.getLogger(ByClawSkillPathResolver.class);

    /**
     * 数字员工模板参数编码。param_value 是数组 JSON，其中 skillPath 可包含 {userCode}/{resourceId} 占位符。
     */
    private static final String TEMPLATE_DIGITAL_EMPLOYEE_PARAM_CODE = "TEMPLATE_DIGITAL_EMPLOYEE";

    @Autowired
    private SystemConfigService systemConfigService;

    @Autowired
    private SsResourceService ssResourceService;

    @Autowired
    private SsResExtDigEmployeeService ssResExtDigEmployeeService;

    /**
     * 解析当前 skill 操作应使用的 skills 根目录。
     *
     * @param userCode 用户编码，用于替换配置路径中的 {userCode}
     * @param resourceId 数字员工资源 ID；为空时保持超级助手默认路径
     * @return 以 "/" 开头、以 "/" 结尾的 skills 根目录
     */
    public String resolveSkillRootPrefix(String userCode, Long resourceId) {
        ResourceSkillContext context = loadResourceContext(resourceId);
        String configuredPath = resolveConfiguredSkillPath(userCode, resourceId, context);
        if (StringUtils.isNotBlank(configuredPath)) {
            return configuredPath;
        }
        return ByClawUserWorkspacePaths.resolveSkillRootPrefix(resourceId, context.resourceCode);
    }

    /**
     * 加载路径判断需要的资源上下文。任何一项缺失都不阻断调用，后续会回退到历史默认路径。
     */
    private ResourceSkillContext loadResourceContext(Long resourceId) {
        if (resourceId == null) {
            return ResourceSkillContext.empty();
        }
        SsResource resource = ssResourceService.findById(resourceId);
        SsResExtDigEmployee ext = ssResExtDigEmployeeService.findById(resourceId);
        return new ResourceSkillContext(
            resource == null ? null : resource.getResourceCode(),
            resource == null ? null : resource.getOwnerType(),
            ext == null ? null : ext.getAgentType());
    }

    /**
     * 根据 TEMPLATE_DIGITAL_EMPLOYEE 中的 ownerType + agentType 命中 skillPath，并完成占位符替换。
     */
    private String resolveConfiguredSkillPath(String userCode, Long resourceId, ResourceSkillContext context) {
        if (resourceId == null || StringUtils.isAnyBlank(context.ownerType, context.agentType)) {
            return null;
        }
        List<TemplateDigitalEmployeeConfig> configs = loadTemplateConfigs();
        for (TemplateDigitalEmployeeConfig config : configs) {
            if (matches(config, context)) {
                return normalizeConfiguredPath(config.getSkillPath(), userCode, resourceId);
            }
        }
        return null;
    }

    private List<TemplateDigitalEmployeeConfig> loadTemplateConfigs() {
        String paramValue = systemConfigService.getStringParamValueByCode(TEMPLATE_DIGITAL_EMPLOYEE_PARAM_CODE);
        if (StringUtils.isBlank(paramValue)) {
            return Collections.emptyList();
        }
        try {
            List<TemplateDigitalEmployeeConfig> configs =
                JSON.parseArray(paramValue, TemplateDigitalEmployeeConfig.class);
            return configs == null ? Collections.emptyList() : configs;
        }
        catch (RuntimeException e) {
            logger.warn("解析数字员工模板技能路径配置失败, paramCode={}", TEMPLATE_DIGITAL_EMPLOYEE_PARAM_CODE, e);
            return Collections.emptyList();
        }
    }

    private boolean matches(TemplateDigitalEmployeeConfig config, ResourceSkillContext context) {
        if (config == null) {
            return false;
        }
        return StringUtils.equalsIgnoreCase(StringUtils.trimToEmpty(config.getOwnerType()), context.ownerType)
            && StringUtils.equals(StringUtils.trimToEmpty(config.getAgentType()), context.agentType);
    }

    /**
     * 归一化配置路径。配置缺失、配置非法时返回 null，由调用方回退到默认路径。
     */
    private String normalizeConfiguredPath(String skillPath, String userCode, Long resourceId) {
        if (StringUtils.isBlank(skillPath)) {
            return null;
        }
        String normalized = skillPath
            .replace("{userCode}", safePathSegment(userCode))
            .replace("{resourceId}", String.valueOf(resourceId))
            .replace('\\', '/')
            .replaceAll("/+", "/");
        if (!normalized.startsWith("/")) {
            normalized = "/" + normalized;
        }
        if (!normalized.endsWith("/")) {
            normalized += "/";
        }
        if (containsParentPathSegment(normalized)) {
            logger.warn("忽略非法数字员工技能路径配置, skillPath={}", skillPath);
            return null;
        }
        return normalized;
    }

    private String safePathSegment(String value) {
        String text = StringUtils.trimToEmpty(value);
        return text.replace('\\', '_').replace('/', '_');
    }

    private boolean containsParentPathSegment(String path) {
        for (String segment : path.split("/")) {
            if ("..".equals(segment)) {
                return true;
            }
        }
        return false;
    }

    private static final class ResourceSkillContext {
        private final String resourceCode;

        private final String ownerType;

        private final String agentType;

        private ResourceSkillContext(String resourceCode, String ownerType, String agentType) {
            this.resourceCode = StringUtils.trimToEmpty(resourceCode);
            this.ownerType = StringUtils.trimToEmpty(ownerType).toLowerCase(Locale.ROOT);
            this.agentType = StringUtils.trimToEmpty(agentType);
        }

        private static ResourceSkillContext empty() {
            return new ResourceSkillContext(null, null, null);
        }
    }

    public static class TemplateDigitalEmployeeConfig {
        private String ownerType;

        private String agentType;

        private String skillPath;

        public String getOwnerType() {
            return ownerType;
        }

        public void setOwnerType(String ownerType) {
            this.ownerType = ownerType;
        }

        public String getAgentType() {
            return agentType;
        }

        public void setAgentType(String agentType) {
            this.agentType = agentType;
        }

        public String getSkillPath() {
            return skillPath;
        }

        public void setSkillPath(String skillPath) {
            this.skillPath = skillPath;
        }
    }
}
