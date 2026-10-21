package com.iwhalecloud.byai.gateway.sandbox.platform;

import java.io.*;
import java.nio.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.*;
import java.time.Instant;
import java.util.*;
import java.util.stream.Stream;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** 文件系统原语选路；不应用对象存储put的父目录创建/chmod策略。 */
@Component
public class PlatformFileSystemRouting {
    private final PlatformRemoteGateway gateway;
    private final ObjectProvider<PlatformStorageClient> clients;
    private final String configuredRoot;
    public PlatformFileSystemRouting(PlatformRemoteGateway gateway,ObjectProvider<PlatformStorageClient> clients,
            @Value("${file.storage.local.path}") String root) {
        this.gateway=gateway;this.clients=clients;this.configuredRoot=root;
    }
    public boolean isRemote(){return gateway.isRemote();}
    public static class RemoteFailure extends IllegalStateException {
        public RemoteFailure(RuntimeException cause){super("Platform filesystem request failed",cause);}
    }
    private String relative(Path path) {
        Path root=Paths.get(configuredRoot).toAbsolutePath().normalize();
        Path target=path.toAbsolutePath().normalize();
        if(!target.startsWith(root)) throw new IllegalArgumentException("Path traversal detected: "+path);
        return root.relativize(target).toString();
    }
    private Object call(String operation,Path path,Object... extra) {
        try {
            Map<String,Object> params=gateway.params("path",relative(path));
            for(int i=0;i<extra.length;i+=2)params.put((String)extra[i],extra[i+1]);
            return gateway.call("filesystem",operation,params);
        } catch(RuntimeException e){throw new RemoteFailure(e);}
    }
    private boolean bool(String operation,Path path) {
        Object value=call(operation,path);
        if(!(value instanceof Boolean))throw new RemoteFailure(new IllegalStateException("Missing boolean result"));
        return (Boolean)value;
    }
    public boolean exists(Path path){return isRemote()?bool("exists",path):Files.exists(path);}
    public boolean isDirectory(Path path){return isRemote()?bool("is-directory",path):Files.isDirectory(path);}
    @SuppressWarnings("unchecked")
    public Stream<Path> list(Path path) throws IOException {
        if(!isRemote())return Files.list(path);
        List<String> names=(List<String>)call("list",path);
        if(names==null)throw new RemoteFailure(new IllegalStateException("Missing directory listing"));
        return names.stream().map(path::resolve);
    }
    public static class Attributes {
        private final long size;private final FileTime modified;
        Attributes(long size,FileTime modified){this.size=size;this.modified=modified;}
        public long size(){return size;}
        public FileTime lastModifiedTime(){return modified;}
    }
    @SuppressWarnings("unchecked")
    public Attributes readAttributes(Path path) throws IOException {
        if(!isRemote()) {
            BasicFileAttributes a=Files.readAttributes(path,BasicFileAttributes.class);
            return new Attributes(a.size(),a.lastModifiedTime());
        }
        Object value=call("attributes",path);
        if(value==null)throw new IOException("File attributes unavailable");
        try {
            Map<String,Object> a=(Map<String,Object>)value;
            return new Attributes(((Number)a.get("size")).longValue(),FileTime.from(Instant.parse((String)a.get("lastModified"))));
        }
        catch(RuntimeException e){throw new RemoteFailure(e);}
    }
    public void createDirectories(Path path) throws IOException {
        if(isRemote())call("create-directories",path);else Files.createDirectories(path);
    }
    public void createFile(Path path) throws IOException {
        if(isRemote())call("create-file",path);else Files.createFile(path);
    }
    public void writeString(Path path,String content) throws IOException {
        if(isRemote())call("write-utf8",path,"content",content);
        else {
            ByteBuffer encoded=StandardCharsets.UTF_8.newEncoder().encode(CharBuffer.wrap(content));
            byte[] bytes=new byte[encoded.remaining()];encoded.get(bytes);
            Files.write(path,bytes,StandardOpenOption.CREATE,StandardOpenOption.TRUNCATE_EXISTING);
        }
    }
    public void deleteIfExists(Path path) throws IOException {
        if(isRemote())call("delete-if-exists",path);else Files.deleteIfExists(path);
    }
    public void writeAtomicUtf8(Path path,String content,String temporaryPrefix) {
        call("atomic-write-utf8",path,"content",content,"temporaryPrefix",temporaryPrefix);
    }
    public void copyReplace(InputStream input,Path path,long size) throws IOException {
        if(!isRemote()){Files.copy(input,path,StandardCopyOption.REPLACE_EXISTING);return;}
        try {
            gateway.data(gateway.safe(()->PlatformStreamingClient.withUpload(input,size,"application/octet-stream",
                    ()->clients.getObject().copyReplace(gateway.params("path",relative(path)),
                            "application/octet-stream",Collections.emptyMap()))));
        } catch(RuntimeException e){throw new RemoteFailure(e);}
    }
}
