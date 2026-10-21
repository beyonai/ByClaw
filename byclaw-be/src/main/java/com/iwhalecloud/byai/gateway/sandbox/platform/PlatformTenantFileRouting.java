package com.iwhalecloud.byai.gateway.sandbox.platform;

import java.nio.file.Path;
import java.util.*;
import org.springframework.stereotype.Component;

/** 仅负责原租户目录的通用文件API选路；生命周期仍在BE。 */
@Component
public class PlatformTenantFileRouting {
    private final PlatformRemoteGateway gateway;
    public PlatformTenantFileRouting(PlatformRemoteGateway gateway){this.gateway=gateway;}
    public boolean isRemote(){return gateway.isRemote();}
    private String relative(Path root,Path path) {
        if(!path.startsWith(root))throw new IllegalArgumentException("Path escapes tenant volume root");
        return root.relativize(path).toString();
    }
    private void invoke(String operation,Map<String,Object> params) {
        Map<String,Object> response=gateway.envelope("filesystem",operation,params);
        if(response!=null&&response.get("code") instanceof Number&&((Number)response.get("code")).intValue()!=0
            && response.get("data") instanceof Map&&"boundary-invalid".equals(((Map<?,?>)response.get("data")).get("error")))
            throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.CONFLICT,"tenant.volume.path.invalid");
        if(!Boolean.TRUE.equals(gateway.data(response)))throw new IllegalStateException("Platform file operation did not acknowledge completion");
    }
    public void prepare(Path root,Path directory,Path privateDirectory) {
        invoke("prepare-private-directory",gateway.params("directory",relative(root,directory),"privateDirectory",relative(root,privateDirectory)));
    }
    public void copy(Path root,Path target,byte[] content) {
        invoke("replace-file",gateway.params("path",relative(root,target),"content",Base64.getEncoder().encodeToString(content)));
    }
    public void delete(Path root,Path boundary,Path target) {
        invoke("delete-tree",gateway.params("boundary",relative(root,boundary),"path",relative(root,target)));
    }
}
