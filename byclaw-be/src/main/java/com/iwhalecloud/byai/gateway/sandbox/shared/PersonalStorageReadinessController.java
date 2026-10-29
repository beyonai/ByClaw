package com.iwhalecloud.byai.gateway.sandbox.shared;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformRemoteGateway;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContextHolder;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/storage/personal")
public class PersonalStorageReadinessController {
    private final PlatformRemoteGateway gateway;
    public PersonalStorageReadinessController(PlatformRemoteGateway gateway){this.gateway=gateway;}
    @PostMapping("/readiness") public ResponseUtil<?> readiness() {
        String user=CurrentUserHolder.getCurrentUserCode();
        if(user==null || user.isBlank())throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        if(!gateway.isRemote() || TenantRequestContextHolder.get()!=null)
            return ResponseUtil.successResponse(Map.of("enabled",false,"ready",true,"state","DISABLED"));
        return ResponseUtil.successResponse(gateway.call("storage","personal/readiness",Map.of("userCode",user)));
    }
}
