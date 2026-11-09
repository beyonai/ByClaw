package com.iwhalecloud.byai.state.interfaces.controller.notification;

import java.util.Map;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.domain.mobilepush.MobilePushProperties;
import com.iwhalecloud.byai.state.domain.mobilepush.MobilePushStore;
import com.iwhalecloud.byai.state.domain.mobilepush.PushDeviceBinding;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 沿用现有登录拦截和签名；不增加任意发推送接口，也不返回服务端管理员密钥。 */
@RestController
@RequestMapping("/mobile-push")
public class MobilePushController {
    private final MobilePushProperties properties;
    private final MobilePushStore store;

    public MobilePushController(MobilePushProperties properties, MobilePushStore store) {
        this.properties = properties;
        this.store = store;
    }

    @GetMapping("/config")
    public ResponseUtil<Map<String, Object>> configuration() {
        if (!authenticated() || !properties.ready()) {
            return ResponseUtil.successResponse(Map.of("enabled", false));
        }
        return ResponseUtil.successResponse(Map.of("enabled", true, "sdkAppId", properties.getSdkAppId(),
            "appKey", properties.getClientAppKey(), "environmentId", properties.getEnvironmentId()));
    }

    @PostMapping("/devices/bind")
    public ResponseUtil<Map<String, Object>> bind(@Valid @RequestBody PushDeviceBinding binding) {
        if (!authenticated()) {
            return ResponseUtil.failI18n("groupchat.authenticationRequired");
        }
        if (!properties.ready()) {
            return ResponseUtil.failI18n("mobilepush.unavailable");
        }
        boolean enabled = store.bind(CurrentUserHolder.getCurrentUserId(), binding);
        return ResponseUtil.successResponse(Map.of("revision", binding.revision(), "enabled", enabled));
    }

    @PostMapping("/devices/unbind")
    public ResponseUtil<Boolean> unbind(@Valid @RequestBody UnbindDevice binding) {
        if (!authenticated()) {
            return ResponseUtil.failI18n("groupchat.authenticationRequired");
        }
        store.unbind(CurrentUserHolder.getCurrentUserId(), binding.installationId(), binding.revision());
        return ResponseUtil.successResponse(true);
    }

    private boolean authenticated() {
        return CurrentUserHolder.getCurrentUserId() != null && CurrentUserHolder.getCurrentUserId() > 0;
    }

    public record UnbindDevice(
        @NotBlank @Pattern(regexp = "[A-Za-z0-9_-]{16,128}") String installationId,
        @Min(1) @Max(9007199254740991L) long revision
    ) {
    }
}
