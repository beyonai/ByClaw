package com.iwhalecloud.byai.state.application.service.chat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.storage.model.StorageLocation;
import com.iwhalecloud.byai.state.domain.file.service.ConversationFileStorage;
import com.iwhalecloud.byai.state.domain.file.service.ConversationStoragePathResolver;
import com.iwhalecloud.byai.state.domain.session.dto.ConversationFilePathDto;
import com.iwhalecloud.byai.state.domain.session.qo.ConversationAppendTxtQo;
import com.iwhalecloud.byai.state.domain.session.qo.ConversationReadQo;
import com.iwhalecloud.byai.state.domain.session.qo.ConversationWriteTxtQo;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

@ExtendWith(MockitoExtension.class)
class OpenApiConversationApplicationServiceTest {

    @Mock
    private ConversationStoragePathResolver conversationStoragePathResolver;

    @Mock
    private ConversationFileStorage conversationFileStorage;

    private OpenApiConversationApplicationService service;

    @BeforeEach
    void setUp() {
        CurrentUserHolder.clearLoginInfo();
        service = new OpenApiConversationApplicationService();
        ReflectionTestUtils.setField(service, "conversationStoragePathResolver", conversationStoragePathResolver);
        ReflectionTestUtils.setField(service, "conversationFileStorage", conversationFileStorage);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void writeTxt_usesUserFsSessionsPathAndReturnsInternalObjectKey() throws Exception {
        when(conversationStoragePathResolver.normalizeDisplayFilePath("reports/out.md")).thenReturn("/reports/out.md");
        StorageLocation location = StorageLocation.of("conversation", "byclaw-user001",
            "/.sessions/sess-1/reports/out.md");
        when(conversationStoragePathResolver.objectKey("user001", "/.sessions/sess-1/reports/out.md"))
            .thenReturn(location);
        ConversationWriteTxtQo qo = new ConversationWriteTxtQo();
        qo.setUserCode("user001");
        qo.setSessionId("sess-1");
        qo.setFilePath("reports/out.md");
        qo.setContent("# ok");

        ConversationFilePathDto result = service.writeTxt(qo);

        verify(conversationFileStorage).writeText(eq(location), eq("# ok"), eq("text/markdown"));
        assertThat(result.getFilePath()).isEqualTo("/reports/out.md");
        assertThat(result.getObjectKey()).isEqualTo("/.sessions/sess-1/reports/out.md");
        assertThat(CurrentUserHolder.getLoginInfo()).isNull();
    }

    @Test
    void appendTxt_readsExistingContentThroughUserFsAndWritesMergedContent() throws Exception {
        when(conversationStoragePathResolver.normalizeDisplayFilePath("/out.txt")).thenReturn("/out.txt");
        StorageLocation location = StorageLocation.of("conversation", "byclaw-user001", "/.sessions/sess-1/out.txt");
        when(conversationStoragePathResolver.objectKey("user001", "/.sessions/sess-1/out.txt")).thenReturn(location);
        ConversationAppendTxtQo qo = new ConversationAppendTxtQo();
        qo.setUserCode("user001");
        qo.setSessionId("sess-1");
        qo.setFilePath("/out.txt");
        qo.setContent("new");

        ConversationFilePathDto result = service.appendTxt(qo);

        verify(conversationFileStorage).appendText(eq(location), eq("new"), eq("text/plain"));
        assertThat(result.getObjectKey()).isEqualTo("/.sessions/sess-1/out.txt");
    }

    @Test
    void read_acceptsObjectKeyAndStreamsSelectedLinesWithUserContext() throws Exception {
        LoginInfo originalLogin = new LoginInfo();
        originalLogin.setUserCode("original");
        CurrentUserHolder.setLoginInfo(originalLogin);
        StorageLocation location = StorageLocation.of("conversation", "byclaw-user001", "/.sessions/sess-1/out.txt");
        when(conversationStoragePathResolver.objectKey("user001", "/.sessions/sess-1/out.txt")).thenReturn(location);
        doAnswer(invocation -> {
            assertThat(CurrentUserHolder.getCurrentUserCode()).isEqualTo("user001");
            OutputStream outputStream = invocation.getArgument(3);
            outputStream.write("b\nc".getBytes(StandardCharsets.UTF_8));
            return null;
        }).when(conversationFileStorage).streamTextByLines(eq(location), eq(1), eq(3), any(OutputStream.class));
        ConversationReadQo qo = new ConversationReadQo();
        qo.setUserCode("user001");
        qo.setSessionId("sess-1");
        qo.setObjectKey("/.sessions/sess-1/out.txt");
        qo.setBeginLine(1);
        qo.setEndLine(3);

        StreamingResponseBody body = service.read(qo);
        ByteArrayOutputStream outputStream = new ByteArrayOutputStream();
        body.writeTo(outputStream);

        assertThat(outputStream.toString(StandardCharsets.UTF_8)).isEqualTo("b\nc");
        assertThat(CurrentUserHolder.getLoginInfo()).isSameAs(originalLogin);
    }
}
