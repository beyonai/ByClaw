package com.iwhalecloud.byai.common.message.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Date;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

@ExtendWith(MockitoExtension.class)
class ByaiMessageHotServiceTest {

    @Mock
    private SequenceService sequenceService;

    @Mock
    private ByaiMessageMapper byaiMessageMapper;

    @InjectMocks
    private ByaiMessageHotService byaiMessageHotService;

    @Test
    void add_preservesExistingCreateTime() {
        Date firstResponseTime = new Date(1000L);
        ByaiMessageHotDto dto = new ByaiMessageHotDto();
        dto.setMessageId(21L);
        dto.setCreateTime(firstResponseTime);
        when(sequenceService.nextVal()).thenReturn(1L);
        when(byaiMessageMapper.insertBatch(anyList())).thenReturn(1);

        byaiMessageHotService.add(dto);

        ArgumentCaptor<List<ByaiMessage>> captor = ArgumentCaptor.forClass(List.class);
        verify(byaiMessageMapper).insertBatch(captor.capture());
        assertThat(captor.getValue().get(0).getCreateTime()).isEqualTo(firstResponseTime);
    }

    @Test
    void add_setsCreateTimeWhenMissing() {
        ByaiMessageHotDto dto = new ByaiMessageHotDto();
        dto.setMessageId(21L);
        when(sequenceService.nextVal()).thenReturn(1L);
        when(byaiMessageMapper.insertBatch(anyList())).thenReturn(1);

        byaiMessageHotService.add(dto);

        ArgumentCaptor<List<ByaiMessage>> captor = ArgumentCaptor.forClass(List.class);
        verify(byaiMessageMapper).insertBatch(captor.capture());
        assertThat(captor.getValue().get(0).getCreateTime()).isNotNull();
    }
}
