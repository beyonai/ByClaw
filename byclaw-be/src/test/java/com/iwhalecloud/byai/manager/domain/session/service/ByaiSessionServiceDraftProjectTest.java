package com.iwhalecloud.byai.manager.domain.session.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

@ExtendWith(MockitoExtension.class)
class ByaiSessionServiceDraftProjectTest {

    @Mock
    private ByaiSessionMapper sessionMapper;

    @Test
    void changesProjectOnlyThroughTheConditionalDraftUpdate() {
        ByaiSessionService service = service();
        when(sessionMapper.updateDraftSessionProject(101L, 202L, 303L)).thenReturn(1);

        boolean changed = service.changeDraftProject(101L, 202L, 303L);

        assertThat(changed).isTrue();
        verify(sessionMapper).updateDraftSessionProject(101L, 202L, 303L);
    }

    @Test
    void reportsRejectedUpdateWhenSessionIsNoLongerDraft() {
        ByaiSessionService service = service();
        when(sessionMapper.updateDraftSessionProject(101L, 202L, 303L)).thenReturn(0);

        assertThat(service.changeDraftProject(101L, 202L, 303L)).isFalse();
    }

    private ByaiSessionService service() {
        ByaiSessionService service = new ByaiSessionService();
        ReflectionTestUtils.setField(service, "byaiSessionMapper", sessionMapper);
        return service;
    }
}
