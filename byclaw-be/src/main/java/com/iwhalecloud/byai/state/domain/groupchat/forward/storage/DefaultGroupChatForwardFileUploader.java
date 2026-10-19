package com.iwhalecloud.byai.state.domain.groupchat.forward.storage;

import java.io.*;
import java.nio.file.*;
import java.security.*;
import java.util.*;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.jdbc.core.JdbcTemplate;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantGroupData;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContext;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantMembershipMapper;
import com.iwhalecloud.byai.state.application.service.chat.AssistantChatApplicationService;
import com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationService;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;

/** Download once to a temporary file, then reuse the application's ordinary upload services. */
@Component
public class DefaultGroupChatForwardFileUploader implements GroupChatForwardFileUploader {
    private final AssistantChatApplicationService conversations;
    private final DatasetApplicationService datasets;
    private final UserService users;
    private final ProjectService projects;
    private final JdbcTemplate db;
    private final TenantGroupData tenantData;
    private final TenantMembershipMapper memberships;

    public DefaultGroupChatForwardFileUploader(AssistantChatApplicationService conversations, DatasetApplicationService datasets,
            UserService users, ProjectService projects, JdbcTemplate db, TenantGroupData tenantData,
            TenantMembershipMapper memberships) {
        this.conversations=conversations; this.datasets=datasets; this.users=users; this.projects=projects;
        this.db=db; this.tenantData=tenantData; this.memberships=memberships;
    }

    @Override public ForwardUploadedFile upload(ForwardActor actor, ForwardBackend backend, boolean knowledge,
            ForwardUploadedFile reservation, InputStream source, SourceProof proof, String contentType, long maxBytes) {
        if(actor.enterpriseId()!=reservation.enterpriseId()) throw new IllegalArgumentException("RESOURCE_NOT_ACCESSIBLE");
        Path temporary=null;
        LoginInfo previous=CurrentUserHolder.getLoginInfo();
        try {
            temporary=Files.createTempFile("group-forward-upload-", ".upload");
            var digest=MessageDigest.getInstance("SHA-256");
            long size=0;
            try(OutputStream output=Files.newOutputStream(temporary)) {
                byte[] bytes=new byte[64*1024]; int count;
                while((count=source.read(bytes))!=-1) {
                    size+=count;
                    if(size>maxBytes)throw new IllegalArgumentException("FORWARD_FILE_TOO_LARGE");
                    digest.update(bytes,0,count); output.write(bytes,0,count);
                }
            }
            String sha=HexFormat.of().formatHex(digest.digest());
            if(size!=proof.size() || !sha.equals(proof.sha256()))throw new IllegalArgumentException("FORWARD_SOURCE_CHANGED");
            // Worker threads have no HTTP identity. Bind the already-authorized real actor for existing upload APIs.
            var user=users.findById(actor.userId());
            if(user==null || "X".equalsIgnoreCase(user.getState()) || user.getUserCode()==null)throw new IllegalArgumentException("RESOURCE_NOT_ACCESSIBLE");
            LoginInfo login=new LoginInfo();login.setUserId(actor.userId());login.setUserCode(user.getUserCode());login.setEnterpriseId(actor.enterpriseId());
            CurrentUserHolder.setLoginInfo(login);
            MultipartFile file=new TemporaryFile(temporary,reservation.fileName(),contentType,size);
            Map<String,Object> uploaded=new LinkedHashMap<>();
            if(knowledge) {
                Long cloud=cloud(actor,backend,reservation.targetSessionId());
                String directory="/group-forward-files/"+reservation.targetSessionId()+"/"+reservation.forwardTargetId()
                    +"/"+reservation.itemId()+"/"+reservation.attachmentId()+"/"+reservation.attemptId();
                var result=datasets.uploadFiles(new MultipartFile[]{file},cloud,directory,reservation.fileName(),false,false,false,Map.of());
                if(result==null || result.getUploadItems()==null || result.getUploadItems().size()!=1
                    || result.getFailedItems()!=null && !result.getFailedItems().isEmpty())throw new IllegalStateException("FORWARD_COPY_FAILED");
                var item=result.getUploadItems().getFirst();
                if(Boolean.FALSE.equals(item.getSuccess()) || item.getFilePath()==null || !item.getFilePath().startsWith(directory+"/"))throw new IllegalStateException("FORWARD_COPY_FAILED");
                if(item.getFileId()!=null)uploaded.put("fileId",item.getFileId().toString());
                uploaded.put("fileName",item.getFileName());uploaded.put("filePath",item.getFilePath());
                uploaded.put("cloudResourceId",cloud.toString());uploaded.put("resourceType","KG_DOC_FILE");
            } else {
                var result=conversations.uploadFiles(new MultipartFile[]{file},reservation.targetSessionId(),"hs_as",null,null,
                    "forwards/"+reservation.forwardTargetId()+"/"+reservation.itemId()+"/"+reservation.attachmentId()+"/"+reservation.attemptId());
                if(result==null || result.getUploadItems()==null || result.getUploadItems().size()!=1)throw new IllegalStateException("FORWARD_COPY_FAILED");
                var item=result.getUploadItems().getFirst();
                uploaded.put("fileId",item.getFileId().toString());uploaded.put("fileName",item.getFileName());
                uploaded.put("filePath",item.getFilePath());uploaded.put("fileUrl",item.getFileUrl());uploaded.put("resourceType","COMMON_FILE");
            }
            uploaded.put("mediaType",contentType==null?"application/octet-stream":contentType);uploaded.put("size",size);
            return new ForwardUploadedFile(reservation.enterpriseId(), reservation.targetSessionId(), reservation.forwardTargetId(), reservation.itemId(), reservation.attachmentId(), reservation.attemptId(), reservation.fileName(), contentType, size, sha, reservation.createdAt(), uploaded);
        } catch(IOException e) {throw new UncheckedIOException("FORWARD_COPY_FAILED",e);}
        catch(NoSuchAlgorithmException e) {throw new IllegalStateException(e);}
        catch(RuntimeException e) {throw e;}
        catch(Exception e) {throw new IllegalStateException("FORWARD_COPY_FAILED",e);}
        finally {
            if(previous==null)CurrentUserHolder.clearLoginInfo();else CurrentUserHolder.setLoginInfo(previous);
            if(temporary!=null)try{Files.deleteIfExists(temporary);}catch(IOException ignored){temporary.toFile().deleteOnExit();}
        }
    }

    private Long cloud(ForwardActor actor,ForwardBackend backend,long group) {
        Long projectId;
        if(backend==ForwardBackend.TENANT) {
            var member=memberships.selectActiveMembership(actor.userId(),actor.enterpriseId());
            if(member==null)throw new IllegalArgumentException("RESOURCE_NOT_ACCESSIBLE");
            var data=tenantData.read(new TenantRequestContext(actor.userId(),actor.enterpriseId(),member.getRole()),"group-chats/"+group);
            projectId=data.path("session").path("projectId").asLong(-1);
        } else {
            var rows=db.queryForList("SELECT project_id FROM byai.byai_session WHERE session_id=? AND enterprise_id=?",group,actor.enterpriseId());
            if(rows.size()!=1)throw new IllegalArgumentException("RESOURCE_NOT_ACCESSIBLE");
            Object value=rows.getFirst().get("project_id");projectId=value instanceof Number number?number.longValue():null;
        }
        var project=projectId==null || projectId<=0?null:projects.findById(projectId);
        if(project==null || !Objects.equals(project.getEnterpriseId(),actor.enterpriseId()) || project.getCloudResourceId()==null)
            throw new IllegalArgumentException("FORWARD_TARGET_CLOUD_UNAVAILABLE");
        return project.getCloudResourceId();
    }

    /** Same file-backed multipart technique as task publication; conversation upload retains its existing memory limits. */
    private record TemporaryFile(Path path,String originalFilename,String contentType,long size) implements MultipartFile {
        @Override public String getName(){return "files";}
        @Override public String getOriginalFilename(){return originalFilename;}
        @Override public String getContentType(){return contentType;}
        @Override public boolean isEmpty(){return size==0;}
        @Override public long getSize(){return size;}
        @Override public byte[] getBytes() throws IOException{return Files.readAllBytes(path);}
        @Override public InputStream getInputStream() throws IOException{return Files.newInputStream(path);}
        @Override public void transferTo(File destination) throws IOException{Files.copy(path,destination.toPath(),StandardCopyOption.REPLACE_EXISTING);}
    }
}
