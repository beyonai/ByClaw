package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeClient;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContext;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContextHolder;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class AssistantSessionCancellationTest {
    @Test
    void generatedSessionIsBoundBeforeReturningItForClientPublication() {
        AssistantChatService service = new AssistantChatService();
        SequenceService sequence = mock(SequenceService.class);
        when(sequence.nextVal()).thenReturn(42L);
        ReflectionTestUtils.setField(service, "sequenceService", sequence);
        ReflectionTestUtils.setField(service, "tenantNodeClient", mock(TenantNodeClient.class));
        TenantRequestContextHolder.set(new TenantRequestContext(1, 123, "MEMBER"));
        AtomicLong bound = new AtomicLong();
        AssistantChatDto request = new AssistantChatDto();
        try {
            ChatRequestCancellation.run(new AtomicBoolean(), bound::set, () -> service.createGroupChatSession(request));
            assertThat(bound).hasValue(42);
            assertThat(request.getSessionId()).isEqualTo(42);
        }
        finally { TenantRequestContextHolder.clear(); }
    }
}
