package com.iwhalecloud.byai.gateway.sandbox.platform;

import java.nio.file.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** 私密文件IO远程端口；不处理授权、解密或凭据JSON，不回调BE。 */
@Component
public class PlatformPrivateFileSystemRouting {
    private final PlatformRemoteGateway gateway;
    private final String canonicalFileRoot;
    public PlatformPrivateFileSystemRouting(PlatformRemoteGateway gateway,
            @Value("${byclaw.platform.canonical-file-root:}") String canonicalFileRoot) {
        this.gateway=gateway;this.canonicalFileRoot=canonicalFileRoot;
    }
    public boolean isRemote(){return gateway.isRemote();}
    public static class RemoteFailure extends IllegalStateException {
        public RemoteFailure(RuntimeException cause){super(cause instanceof ConfigurationFailure ? cause.getMessage() : "Platform private filesystem request failed",cause);}
    }
    private static class ConfigurationFailure extends IllegalStateException {
        ConfigurationFailure(String message){super(message);}
    }
    private Path mappedRoot() {
        if(canonicalFileRoot==null||canonicalFileRoot.trim().isEmpty())
            throw new ConfigurationFailure("Configure byclaw.platform.canonical-file-root for remote private IO");
        Path root=Paths.get(canonicalFileRoot);
        if(!root.isAbsolute())throw new ConfigurationFailure("byclaw.platform.canonical-file-root must be an absolute canonical path");
        return root.normalize();
    }
    private Object call(String operation,Path path,Object... extra) {
        try {
            Path root=mappedRoot();
            Map<String,Object> params=gateway.params("path","");
            if(path!=null) {
                Path target=path.toAbsolutePath().normalize();
                if(!target.startsWith(root))throw new IllegalArgumentException("Private path escapes declared canonical root");
                params.put("path",root.relativize(target).toString());
            }
            for(int i=0;i<extra.length;i+=2)params.put((String)extra[i],extra[i+1]);
            return gateway.call("private-filesystem",operation,params);
        } catch(RuntimeException failure){throw new RemoteFailure(failure);}
    }
    public Path trustedRoot(){call("trust-root",null);return mappedRoot();}
    public Path prepareDirectory(Path path,boolean privateDirectory){call("prepare-directory",path,"privateDirectory",privateDirectory);return path;}
    public Path realDirectory(Path path){call("validate-directory",path);return path;}
    public void chmodDirectory(Path path){call("chmod-directory",path);}
    public void rejectSymbolicLink(Path path){call("reject-symlink",path);}
    public void chmodFile(Path path){call("chmod-file",path);}
    public byte[] readCandidate(Path path,long maxBytes) {
        Object value=call("read-candidate",path,"maxBytes",maxBytes);
        if(value==null)return null;
        try {
            byte[] bytes=Base64.getDecoder().decode((String)value);
            if(bytes.length>maxBytes)throw new IllegalStateException("Private read exceeds bound");
            return bytes;
        }catch(RuntimeException failure){throw new RemoteFailure(failure);}
    }
    public void writeAtomic(Path path,byte[] bytes,String temporaryPrefix){
        call("write-atomic",path,"content",Base64.getEncoder().encodeToString(bytes),"temporaryPrefix",temporaryPrefix);
    }
    public void delete(Path path){call("delete",path);}
}
