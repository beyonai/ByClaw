package com.iwhalecloud.byai.state.domain.groupchat;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.function.Supplier;

import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxUserContextRunner;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatDisposition;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatDispositionReader;

class GroupChatDispositionReaderTest {
    @Test
    void readsValidTaskForCurrentDispatch() {
        GroupChatDispositionReader reader = reader("{\"schemaVersion\":\"1\",\"dispatchId\":\"9\","
            + "\"kind\":\"TASK\",\"taskName\":\"财务报告\",\"ackText\":\"收到\"}");

        GroupChatDisposition disposition = reader.read("u1", 8L, 9L);

        assertEquals("TASK", disposition.getKind());
        assertEquals("财务报告", disposition.getTaskName());
    }

    @Test
    void rejectsMismatchedDispatchAndMalformedJson() {
        assertNull(reader("{\"schemaVersion\":\"1\",\"dispatchId\":\"10\",\"kind\":\"CHAT\"}")
            .read("u1", 8L, 9L));
        assertNull(reader("{partial").read("u1", 8L, 9L));
    }

    @SuppressWarnings("unchecked")
    private GroupChatDispositionReader reader(String json) {
        UserFS userFS = mock(UserFS.class);
        when(userFS.read("/.sessions/8/.byclaw/group-chat-disposition.json"))
            .thenReturn(new ByteArrayInputStream(json.getBytes(StandardCharsets.UTF_8)));
        SandboxUserContextRunner runner = mock(SandboxUserContextRunner.class);
        when(runner.callAsUser(eq("u1"), any(Supplier.class)))
            .thenAnswer(invocation -> ((Supplier<?>) invocation.getArgument(1)).get());
        return new GroupChatDispositionReader(userFS, runner, new ObjectMapper());
    }
}
