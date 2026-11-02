package com.iwhalecloud.byai.state.domain.groupchat.forward;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.multipart.MultipartFile;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantGroupData;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantMembershipMapper;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.dto.resource.*;
import com.iwhalecloud.byai.manager.dto.session.SessionUploadResult;
import com.iwhalecloud.byai.state.application.service.chat.AssistantChatApplicationService;
import com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationService;
import com.iwhalecloud.byai.state.domain.groupchat.forward.config.GroupChatForwardProperties;
import com.iwhalecloud.byai.state.domain.groupchat.forward.storage.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardUploadedFiles;
import static com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;

class GroupChatForwardFileUploaderTest {
    final AssistantChatApplicationService conversations=mock(AssistantChatApplicationService.class);
    final DatasetApplicationService datasets=mock(DatasetApplicationService.class);
    final UserService users=mock(UserService.class);
    final ProjectService projects=mock(ProjectService.class);
    final JdbcTemplate db=mock(JdbcTemplate.class);
    final DefaultGroupChatForwardFileUploader uploader=new DefaultGroupChatForwardFileUploader(conversations,datasets,users,projects,db,
        mock(TenantGroupData.class),mock(TenantMembershipMapper.class));
    final ForwardActor actor=new ForwardActor(7,1);
    final byte[] bytes="independent copy".getBytes(StandardCharsets.UTF_8);
    final ForwardUploadedFile reservation=new ForwardUploadReservation(new GroupChatForwardProperties()).allocate(1,20,200,"300","slot","report.txt");
    @BeforeEach void actor() {
        var user=new Users();user.setUserCode("sender");when(users.findById(7L)).thenReturn(user);
    }
    @AfterEach void clear() {CurrentUserHolder.clearLoginInfo();}
    SourceProof proof() throws Exception {return new SourceProof("proof",new SourceIdentity(1,7L,"file","byclaw-original","/by/source",null),bytes.length,
        HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)));}
    UploadItem item(String path) {var item=new UploadItem();item.setFileId(700L);item.setFileName("report(1).txt");item.setFilePath(path);item.setFileUrl("/commonFile/preview?filePath="+path);return item;}
    @Test void commonFileUsesExistingUploadAndRestoresCaller() throws Exception {
        LoginInfo previous=new LoginInfo();previous.setUserId(99L);CurrentUserHolder.setLoginInfo(previous);
        when(conversations.uploadFiles(any(),eq(20L),eq("hs_as"),isNull(),isNull(),anyString())).thenAnswer(invocation -> {
            assertThat(CurrentUserHolder.getCurrentUserId()).isEqualTo(7L);
            MultipartFile[] files=invocation.getArgument(0);assertThat(files[0].getBytes()).isEqualTo(bytes);
            assertThat((String)invocation.getArgument(5)).startsWith("forwards/200/300/slot/");
            var result=new SessionUploadResult();result.getUploadItems().add(item("/.sessions/20/report(1).txt"));return result;
        });
        var result=uploader.upload(actor,ForwardBackend.LEGACY,false,reservation,new ByteArrayInputStream(bytes),proof(),"text/plain",1024);
        assertThat(result.uploadedFile()).containsEntry("fileId","700").containsEntry("fileName","report(1).txt");
        assertThat(ForwardUploadedFiles.attachment(result).fileUrl()).startsWith("/commonFile/preview?");
        assertThat(CurrentUserHolder.getLoginInfo()).isSameAs(previous);verifyNoInteractions(datasets);
    }
    @Test void knowledgeFileUploadsToTargetProjectUsingPublicationFlags() throws Exception {
        when(db.queryForList(anyString(),eq(20L),eq(1L))).thenReturn(List.of(Map.of("project_id",30L)));
        var project=new Project();project.setEnterpriseId(1L);project.setCloudResourceId(40L);when(projects.findById(30L)).thenReturn(project);
        when(datasets.uploadFiles(any(),eq(40L),anyString(),eq("report.txt"),eq(false),eq(false),eq(false),eq(Map.of())))
            .thenAnswer(invocation -> {
                String directory=invocation.getArgument(2);assertThat(directory).startsWith("/group-forward-files/20/200/300/slot/");
                MultipartFile[] files=invocation.getArgument(0);assertThat(files[0].getBytes()).isEqualTo(bytes);
                var result=new UploadResult();var file=item(directory+"/report.txt");file.setFileId(null);file.setFileName("report.txt");result.getUploadItems().add(file);return result;
            });
        var result=uploader.upload(actor,ForwardBackend.LEGACY,true,reservation,new ByteArrayInputStream(bytes),proof(),"text/plain",1024);
        var file=ForwardUploadedFiles.attachment(result);assertThat(file.cloudResourceId()).isEqualTo("40");assertThat(file.fileId()).isNull();
        var reference=ForwardUploadedFiles.reference(file);assertThat(reference.resourceCode()).contains("\"datasetId\":\"40\"");
        assertThat(reference.resourceId()).isEqualTo(file.filePath());verifyNoInteractions(conversations);
    }
    @Test void changedBytesNeverReachUploadServices() throws Exception {
        assertThatThrownBy(() -> uploader.upload(actor,ForwardBackend.LEGACY,false,reservation,new ByteArrayInputStream("changed".getBytes()),proof(),"text/plain",1024))
            .hasMessage("FORWARD_SOURCE_CHANGED");verifyNoInteractions(conversations,datasets);
    }
    @Test void missingTargetCloudDoesNotFallbackToConversationUpload() throws Exception {
        when(db.queryForList(anyString(),eq(20L),eq(1L))).thenReturn(List.of(Map.of("project_id",-1L)));
        assertThatThrownBy(() -> uploader.upload(actor,ForwardBackend.LEGACY,true,reservation,new ByteArrayInputStream(bytes),proof(),"text/plain",1024))
            .hasMessage("FORWARD_TARGET_CLOUD_UNAVAILABLE");verifyNoInteractions(conversations,datasets);
    }
    @Test void ordinaryUploadKeepsSameNameCopiesSeparateAndDownloadSelectorsRoundTrip() throws Exception {
        var service=mock(AssistantChatApplicationService.class,CALLS_REAL_METHODS);
        var files=mock(com.iwhalecloud.byai.manager.domain.customer.service.FilesService.class);
        var storage=mock(com.iwhalecloud.byai.state.domain.file.service.ConversationFileStorage.class);
        var paths=mock(com.iwhalecloud.byai.state.domain.file.service.ConversationStoragePathResolver.class);
        org.springframework.test.util.ReflectionTestUtils.setField(service,"filesService",files);
        org.springframework.test.util.ReflectionTestUtils.setField(service,"conversationFileStorage",storage);
        org.springframework.test.util.ReflectionTestUtils.setField(service,"conversationStoragePathResolver",paths);
        org.springframework.test.util.ReflectionTestUtils.setField(service,"sessionService",mock(com.iwhalecloud.byai.state.domain.session.service.SessionService.class));
        org.springframework.test.util.ReflectionTestUtils.setField(service,"byaiSystemConfigService",mock(com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService.class));
        when(files.countSessionFile(eq(20L),anyString())).thenReturn(1L);
        var sequence=new java.util.concurrent.atomic.AtomicLong(700);
        when(files.createUploadFile(anyString(),anyString(),anyString(),isNull(),eq(-1L),eq(20L),anyString())).thenAnswer(call -> {
            var file=new com.iwhalecloud.byai.manager.entity.file.Files();file.setFileId(sequence.incrementAndGet());file.setConvertFileName(call.getArgument(1));return file;
        });
        when(paths.conversationFile(eq("sender"),eq("20"),anyString())).thenAnswer(call ->
            com.iwhalecloud.byai.common.storage.model.StorageLocation.of("conversation","byclaw-sender","/.sessions/20/"+call.getArgument(2)));
        when(paths.normalizeDisplayFilePath(anyString())).thenAnswer(call -> call.getArgument(0));
        LoginInfo login=new LoginInfo();login.setUserId(7L);login.setUserCode("sender");CurrentUserHolder.setLoginInfo(login);
        var file=new org.springframework.mock.web.MockMultipartFile("files","报告 +&.txt","text/plain",bytes);
        var first=service.uploadFiles(new MultipartFile[]{file},20L,"hs_as",null,null,"forwards/first").getUploadItems().getFirst();
        var second=service.uploadFiles(new MultipartFile[]{file},20L,"hs_as",null,null,"forwards/second").getUploadItems().getFirst();
        assertThat(first.getFileId()).isNotEqualTo(second.getFileId());
        assertThat(first.getFileName()).isEqualTo("报告 +&(1).txt");
        assertThat(first.getFilePath()).isNotEqualTo(second.getFilePath());
        assertThat(com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.source.ForwardSourceFacts.uploadPath(first.getFileUrl(),"byclaw-sender"))
            .isEqualTo("/by"+first.getFilePath());
        var written=org.mockito.ArgumentCaptor.forClass(com.iwhalecloud.byai.common.storage.model.StorageLocation.class);
        verify(storage,times(2)).writeBytes(written.capture(),eq(bytes),eq("text/plain"));
        assertThat(written.getAllValues().get(0).getPath()).isNotEqualTo(written.getAllValues().get(1).getPath());
    }
    @Test void fileReferencesReplaceTokensOnceAndKeepSameNamesSeparate() {
        String result=ForwardUploadedFiles.replaceTokens("{{old}} {{other}}",Map.of("old","COMMON_FILE_700","other","COMMON_FILE_701"));
        assertThat(result).isEqualTo("{{COMMON_FILE_700}} {{COMMON_FILE_701}}");
        assertThat(ForwardUploadedFiles.replaceTokens("{{a}}",Map.of("a","b","b","c"))).isEqualTo("{{b}}");
    }
}
