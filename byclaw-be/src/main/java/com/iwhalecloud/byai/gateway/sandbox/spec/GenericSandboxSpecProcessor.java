package com.iwhalecloud.byai.gateway.sandbox.spec;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.iwhalecloud.byai.gateway.sandbox.client.model.CreateSandboxRequest;
import com.iwhalecloud.byai.gateway.sandbox.client.model.HostVolume;
import com.iwhalecloud.byai.gateway.sandbox.client.model.ImageSpec;
import com.iwhalecloud.byai.gateway.sandbox.client.model.Volume;
import com.iwhalecloud.byai.gateway.sandbox.service.EnvTemplateRenderer;
import com.iwhalecloud.byai.gateway.sandbox.workspace.SandboxWorkspaceBootstrapInitializer;
import com.iwhalecloud.byai.gateway.sandbox.workspace.model.SandboxFsInitContext;

/**
 * Generic processor driven by {@link SandboxServiceSpec}.
 *
 * It is responsible for:
 * - bootstrap: delegates workspace initialization to {@link SandboxWorkspaceBootstrapInitializer}
 * - create CreateSandboxRequest: image/startup/env/resourceLimits/volumes
 */
public class GenericSandboxSpecProcessor implements SandboxSpecProcessor {

    private static final Logger log = LoggerFactory.getLogger(GenericSandboxSpecProcessor.class);
    private final SandboxWorkspaceBootstrapInitializer bootstrapInitializer;
    private final EnvTemplateRenderer envTemplateRenderer = new EnvTemplateRenderer();

    public GenericSandboxSpecProcessor(SandboxWorkspaceBootstrapInitializer bootstrapInitializer) {
        this.bootstrapInitializer = bootstrapInitializer;
    }

    @Override
    public CreateSandboxRequest buildCreateRequest(String userCode,
                                                     String serviceKey,
                                                     Map<String, String> envVars,
                                                     Map<String, Object> userInfo,
                                                     SandboxServiceSpec spec) {
        if (spec == null) {
            throw new IllegalArgumentException("spec is required");
        }
        if (StringUtils.isBlank(spec.getImage())) {
            throw new IllegalArgumentException("spec.image is required");
        }
        if (spec.getStartup() == null || spec.getStartup().getEntrypoint() == null) {
            // allow null startup, but container may rely on it. In DB spec you should set it.
            log.debug("Spec {} has no startup.entrypoint, CreateSandboxRequest.entrypoint will be empty", serviceKey);
        }

        String workspaceHost = resolveWorkspaceHost(spec, userCode, serviceKey, envVars);

        // volumes
        List<Volume> volumes = buildVolumes(spec, userCode, serviceKey, workspaceHost, envVars);

        // bootstrap operations (best-effort; should not block sandbox creation if host FS is read-only)
        bootstrapIfNecessary(spec, userCode, serviceKey, workspaceHost, userInfo, envVars, volumes);

        // Only keep env keys declared in spec.env.
        // envVars is used only as template context when rendering spec values.
        Map<String, String> mergedEnv = resolveSpecEnv(spec.getEnv(), envVars, userCode, serviceKey, userInfo);

        CreateSandboxRequest.CreateSandboxRequestBuilder builder = CreateSandboxRequest.builder()
                .image(ImageSpec.builder().uri(spec.getImage()).build())
                .timeout(spec.getTimeout())
                .resourceLimits(spec.getResourceLimits())
                .env(mergedEnv)
                .metadata(Map.of("userCode", userCode, "serviceKey", serviceKey))
                .entrypoint(spec.getStartup() != null ? spec.getStartup().getEntrypoint() : null)
                .volumes(volumes);

        return builder.build();
    }

    private String resolveWorkspaceHost(SandboxServiceSpec spec, String userCode, String serviceKey, Map<String, String> envVars) {
        if (spec.getBootstrap() == null || spec.getBootstrap().getCopyTemplate() == null) {
            return null;
        }
        CopyTemplateOp op = spec.getBootstrap().getCopyTemplate();
        return renderPathTemplate(op.getTargetPathTemplate(), userCode, serviceKey, null, null, envVars);
    }

    private void bootstrapIfNecessary(SandboxServiceSpec spec,
                                      String userCode,
                                      String serviceKey,
                                      String workspaceHost,
                                      Map<String, Object> userInfo,
                                      Map<String, String> envVars,
                                      List<Volume> volumes) {
        if (spec.getBootstrap() == null) {
            return;
        }

        // Resolve template source path if a copy-template operation is configured.
        String templateSourceStr = null;
        if (spec.getBootstrap().getCopyTemplate() != null) {
            CopyTemplateOp op = spec.getBootstrap().getCopyTemplate();
            String targetVolumeKey = op.getTargetVolumeKey();
            // Find the volume by key and get its host path
            if (volumes != null && StringUtils.isNotBlank(targetVolumeKey)) {
                templateSourceStr = volumes.stream()
                        .filter(v -> targetVolumeKey.equals(v.getKey()))
                        .findFirst()
                        .map(v -> v.getMountPath())
                        .orElse(null);
            }
        }

        SandboxFsInitContext ctx = SandboxFsInitContext.builder()
                .userCode(userCode)
                .serviceKey(serviceKey)
                .templateSourcePath(templateSourceStr != null ? Path.of(templateSourceStr) : null)
                .workspaceTargetPath(workspaceHost)
                .userInfo(userInfo)
                .templateJson(spec.getTemplateJson())
                .build();

        bootstrapInitializer.initialize(ctx);
    }

    private Map<String, String> resolveSpecEnv(Map<String, String> specEnv,
                                               Map<String, String> templateEnvContext,
                                               String userCode,
                                               String serviceKey,
                                               Map<String, Object> userInfo) {
        if (specEnv == null || specEnv.isEmpty()) {
            return null;
        }

        Map<String, String> result = new java.util.HashMap<>();
        if (specEnv != null) {
            for (Map.Entry<String, String> e : specEnv.entrySet()) {
                String key = e.getKey();
                String value = e.getValue();
                if (value == null) continue;
                result.put(key, renderEnvValue(value, userCode, serviceKey, userInfo, templateEnvContext));
            }
        }
        return result.isEmpty() ? null : result;
    }

    private String renderEnvValue(String template,
                                    String userCode,
                                    String serviceKey,
                                    Map<String, Object> userInfo,
                                    Map<String, String> envVars) {
        if (template == null) return null;
        // basic placeholders
        String rendered = template
                .replace("${user_code}", userCode == null ? "" : userCode)
                .replace("${service_key}", serviceKey == null ? "" : serviceKey);
        // EnvTemplateRenderer supports ${userInfo.xxx}, ${envVars.xxx} and ${env.xxx}
        return envTemplateRenderer.render(rendered, userInfo, envVars);
    }

    private List<Volume> buildVolumes(SandboxServiceSpec spec,
                                      String userCode,
                                      String serviceKey,
                                      String workspaceHost, Map<String, String> envVars) {
        if (spec.getVolumes() == null || spec.getVolumes().isEmpty()) {
            return null;
        }

        List<Volume> volumes = new ArrayList<>();
        int i = 0;
        for (VolumeSpec v : spec.getVolumes()) {
            if (v == null) continue;
            String hostPath = renderPathTemplate(v.getHostPath(), userCode, serviceKey, workspaceHost, null, envVars);
            String mountPath = renderPathTemplate(v.getMountPath(), userCode, serviceKey, workspaceHost, null, envVars);
            String subPath = renderPathTemplate(v.getSubPath(), userCode, serviceKey, workspaceHost, null, envVars);
            if ((StringUtils.isBlank(hostPath) && StringUtils.isBlank(subPath)) || StringUtils.isBlank(mountPath)) {
                continue;
            }
            var vb = Volume.builder()
                .key(v.getKey())
                .name(userCode + "-" + serviceKey + "-" + i)
                .host(new HostVolume(hostPath))
                .mountPath(mountPath)
                .scope(v.getScope().name())
                .readOnly(v.getReadOnly() != null ? v.getReadOnly() : false);
            if (v.getSubPath() != null) {
                vb.subPath(subPath);
            }
            volumes.add(vb.build());
            i++;
        }
        return volumes;
    }

    private String renderPathTemplate(String template,
                                        String userCode,
                                        String serviceKey,
                                        String workspaceHost,
                                        Map<String, Object> userInfo,
                                        Map<String, String> envVars) {
        if (template == null) {
            return null;
        }
        String rendered = template
                .replace("${user_code}", userCode == null ? "" : userCode)
                .replace("${service_key}", serviceKey == null ? "" : serviceKey)
                .replace("${workspace_host}", workspaceHost == null ? "" : workspaceHost);

        // Optionally allow env/userInfo placeholders in paths
        rendered = envTemplateRenderer.render(rendered, userInfo, envVars);
        return rendered;
    }
}
