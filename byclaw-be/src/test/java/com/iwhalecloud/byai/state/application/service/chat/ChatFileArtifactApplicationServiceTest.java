package com.iwhalecloud.byai.state.application.service.chat;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.state.application.service.fs.FsOperationApplicationService;
import com.iwhalecloud.byai.state.domain.chat.dto.ChatFileArtifactResolveRequest;
import com.iwhalecloud.byai.state.domain.chat.vo.ChatFileArtifactVo;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ChatFileArtifactApplicationServiceTest {

    private static final Long SESSION_ID = 10175425L;

    @Mock
    private SessionService sessionService;

    @Mock
    private SessionMemberService sessionMemberService;

    @Mock
    private LoginApplicationService loginApplicationService;

    @Mock
    private FsOperationApplicationService fsOperationApplicationService;

    @Mock
    private UserFS userFS;

    private ChatFileArtifactApplicationService service;

    @BeforeEach
    void setUp() {
        service = new ChatFileArtifactApplicationService(sessionService, sessionMemberService,
            loginApplicationService, fsOperationApplicationService, userFS);
        setCurrentUser(1001L, "owner");
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void resolvesFileInsideAccessibleSession() {
        ByaiSession session = session(1001L);
        when(sessionService.findById(SESSION_ID)).thenReturn(session);
        FileMetadata metadata = metadata("周报.pptx", 640L,
            "application/vnd.openxmlformats-officedocument.presentationml.presentation");
        when(userFS.metadata("/.sessions/10175425/output/周报.pptx")).thenReturn(metadata);

        List<ChatFileArtifactVo> result = service.resolve(request(
            "/by/.sessions/10175425/output/周报.pptx"));

        assertThat(result).hasSize(1);
        assertThat(result.get(0).getPath()).isEqualTo("/.sessions/10175425/output/周报.pptx");
        assertThat(result.get(0).getFileName()).isEqualTo("周报.pptx");
        assertThat(CurrentUserHolder.getCurrentUserCode()).isEqualTo("owner");
    }

    @Test
    void doesNotResolveFileFromAnotherSession() {
        when(sessionService.findById(SESSION_ID)).thenReturn(session(1001L));

        List<ChatFileArtifactVo> result = service.resolve(request(
            "/by/.sessions/999999/output/secret.txt"));

        assertThat(result).isEmpty();
        verify(userFS, never()).read(any());
    }

    @Test
    void allowsCurrentGroupMemberToResolveArchivedSessionFile() {
        setCurrentUser(2002L, "member");
        when(sessionService.findById(SESSION_ID)).thenReturn(session(1001L));
        when(sessionMemberService.findSessionMember(SESSION_ID, "USER", 2002L))
            .thenReturn(new ByaiSessionMember());
        LoginInfo owner = new LoginInfo();
        owner.setUserId(1001L);
        owner.setUserCode("owner");
        when(loginApplicationService.getLoginInfo(1001L)).thenReturn(owner);
        when(userFS.metadata("/.sessions/10175425/artifacts/m1/report.pdf"))
            .thenAnswer(invocation -> {
                assertThat(CurrentUserHolder.getCurrentUserCode()).isEqualTo("owner");
                return metadata("report.pdf", 12L, "application/pdf");
            });

        List<ChatFileArtifactVo> result = service.resolve(request(
            "/.sessions/10175425/artifacts/m1/report.pdf"));

        assertThat(result).hasSize(1);
        assertThat(CurrentUserHolder.getCurrentUserCode()).isEqualTo("member");
    }

    @Test
    void rejectsUserWithoutSessionAccess() {
        setCurrentUser(3003L, "stranger");
        when(sessionService.findById(SESSION_ID)).thenReturn(session(1001L));

        assertThatThrownBy(() -> service.resolve(request("/.sessions/10175425/output/a.txt")))
            .isInstanceOf(BaseException.class);
    }

    @Test
    void archivesOwnersUserFsFileIntoSession() {
        when(sessionService.findById(SESSION_ID)).thenReturn(session(1001L));
        FileMetadata sourceMetadata = metadata("report.pptx", 4L, "application/pptx");
        when(userFS.metadata("/.openclaw/workspace-baiying-agent-88/output/report.pptx"))
            .thenReturn(sourceMetadata);
        when(userFS.read("/.openclaw/workspace-baiying-agent-88/output/report.pptx"))
            .thenReturn(new ByteArrayInputStream("pptx".getBytes(StandardCharsets.UTF_8)));
        when(userFS.write(any(), eq(4L), eq("application/pptx"),
            org.mockito.ArgumentMatchers.startsWith("/.sessions/10175425/artifacts/m1/")))
            .thenReturn(sourceMetadata);
        when(userFS.metadata(org.mockito.ArgumentMatchers.matches(
            "/\\.sessions/10175425/artifacts/m1/.+/report\\.pptx")))
            .thenReturn(null, sourceMetadata);

        List<ChatFileArtifactVo> result = service.resolve(request(
            "/by/.openclaw/workspace-baiying-agent-88/output/report.pptx"));

        assertThat(result).hasSize(1);
        assertThat(result.get(0).getPath()).startsWith("/.sessions/10175425/artifacts/m1/");
        assertThat(result.get(0).getPath()).endsWith("/report.pptx");
        verify(userFS).write(any(), eq(4L), eq("application/pptx"), eq(result.get(0).getPath()));
    }

    @Test
    void memberCannotArchiveOwnersPrivateFile() {
        setCurrentUser(2002L, "member");
        when(sessionService.findById(SESSION_ID)).thenReturn(session(1001L));
        when(sessionMemberService.findSessionMember(SESSION_ID, "USER", 2002L))
            .thenReturn(new ByaiSessionMember());
        LoginInfo owner = new LoginInfo();
        owner.setUserCode("owner");
        when(loginApplicationService.getLoginInfo(1001L)).thenReturn(owner);

        List<ChatFileArtifactVo> result = service.resolve(request("/by/.shared/private.txt"));

        assertThat(result).isEmpty();
        verify(userFS, never()).read(any());
    }

    @Test
    void downloadRequiresSameSessionPath() {
        when(sessionService.findById(SESSION_ID)).thenReturn(session(1001L));

        assertThatThrownBy(() -> service.download(SESSION_ID, "/.sessions/999/output/a.txt"))
            .isInstanceOf(BaseException.class);
        verify(fsOperationApplicationService, never()).downloadFileAsUser(any(), any(), any(), any());
    }

    private ChatFileArtifactResolveRequest request(String path) {
        ChatFileArtifactResolveRequest request = new ChatFileArtifactResolveRequest();
        request.setSessionId(SESSION_ID);
        request.setMessageId("m1");
        request.setPaths(List.of(path));
        return request;
    }

    private ByaiSession session(Long creatorId) {
        ByaiSession session = new ByaiSession();
        session.setSessionId(SESSION_ID);
        session.setCreatorId(creatorId);
        return session;
    }

    private FileMetadata metadata(String fileName, Long size, String contentType) {
        FileMetadata metadata = new FileMetadata();
        metadata.setFileName(fileName);
        metadata.setFileSize(size);
        metadata.setContentType(contentType);
        return metadata;
    }

    private void setCurrentUser(Long userId, String userCode) {
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(userId);
        loginInfo.setUserCode(userCode);
        CurrentUserHolder.setLoginInfo(loginInfo);
    }
}
