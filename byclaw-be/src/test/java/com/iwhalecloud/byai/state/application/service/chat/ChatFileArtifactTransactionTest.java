package com.iwhalecloud.byai.state.application.service.chat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.common.config.TransactionAdviceConfig;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectMemberService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectService;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.state.application.service.fs.FsOperationApplicationService;
import com.iwhalecloud.byai.state.domain.chat.dto.ChatFileArtifactResolveRequest;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import java.sql.Connection;
import java.util.List;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.TransactionTemplate;

class ChatFileArtifactTransactionTest {
    @AfterEach
    void clearLogin() {
        CurrentUserHolder.clearLoginInfo();
    }

    @ParameterizedTest
    @ValueSource(strings = {"/by/.sessions/100/missing.jpg", "/by/.sessions/200/private.mp3"})
    void missingOrRejectedCandidateDoesNotDiscardTheOwnedSummaryOrRollbackTheCaller(String invalidCandidate)
        throws Exception {
        LoginInfo login = new LoginInfo();
        login.setUserId(7L);
        login.setUserCode("owner7");
        CurrentUserHolder.setLoginInfo(login);
        ByaiSession session = new ByaiSession();
        session.setSessionId(100L);
        session.setCreatorId(7L);
        SessionService sessions = mock(SessionService.class);
        when(sessions.findById(100L)).thenReturn(session);

        DataSource dataSource = mock(DataSource.class);
        Connection outer = mock(Connection.class);
        when(dataSource.getConnection()).thenReturn(outer, mock(Connection.class), mock(Connection.class));
        DataSourceTransactionManager manager = new DataSourceTransactionManager(dataSource);
        TransactionAdviceConfig config = new TransactionAdviceConfig();
        ReflectionTestUtils.setField(config, "transactionManager", manager);
        var advice = config.getAdvisor();
        UserFS files = mock(UserFS.class);
        when(files.metadata(anyString())).thenThrow(new IllegalStateException("candidate does not exist"));
        FileMetadata summary = new FileMetadata();
        summary.setFileName("summary.mp3");
        summary.setContentType("audio/mpeg");
        summary.setFileSize(123L);
        doReturn(summary).when(files).metadata("/.sessions/100/tts/summary.mp3");
        ProxyFactory fileProxy = new ProxyFactory(files);
        fileProxy.addAdvice(advice);

        var target = new ChatFileArtifactApplicationService(sessions, mock(SessionMemberService.class),
            mock(ProjectService.class), mock(ProjectMemberService.class), mock(LoginApplicationService.class),
            mock(FsOperationApplicationService.class), (UserFS) fileProxy.getProxy());
        ProxyFactory artifactProxy = new ProxyFactory(target);
        artifactProxy.addAdvice(advice);
        var artifacts = (ChatFileArtifactApplicationService) artifactProxy.getProxy();
        ChatFileArtifactResolveRequest request = new ChatFileArtifactResolveRequest();
        request.setSessionId(100L);
        request.setPaths(List.of(invalidCandidate, "/by/.sessions/100/tts/summary.mp3"));

        var result = new TransactionTemplate(manager).execute(status -> artifacts.resolve(request));

        assertThat(result).hasSize(1);
        assertThat(result.getFirst().getPath()).isEqualTo("/.sessions/100/tts/summary.mp3");
        assertThat(result.getFirst().getContentType()).isEqualTo("audio/mpeg");
        verify(outer).commit();
        verify(outer, never()).rollback();
        verify(files, never()).metadata("/.sessions/200/private.mp3");
        assertThat(CurrentUserHolder.getCurrentUserId()).isEqualTo(7L);
    }
}
