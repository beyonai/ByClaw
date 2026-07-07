package com.iwhalecloud.byai.common.message.service;

import com.iwhalecloud.byai.common.message.entity.ByaiMessageRel;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageRelObjDto;
import com.iwhalecloud.byai.common.message.dto.MemRelSearchReponseDto;
import com.iwhalecloud.byai.common.message.dto.MemRelSearchRequestDto;
import com.iwhalecloud.byai.common.message.dto.PageResult;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageRelMapper;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.Date;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ByaiMessageRelObjServiceTest {

    private ByaiMessageRelMapper byaiMessageRelMapper;

    private ByaiMessageRelObjService service;

    @BeforeEach
    void setUp() {
        byaiMessageRelMapper = mock(ByaiMessageRelMapper.class);
        service = new ByaiMessageRelObjService();
        ReflectionTestUtils.setField(service, "byaiMessageRelMapper", byaiMessageRelMapper);
    }

    @Test
    void updateFeedback_whenRelIdMissing_updatesByMessagePair() {
        ByaiMessageRelObjDto dto = new ByaiMessageRelObjDto();
        dto.setAskMsgId(10001120L);
        dto.setResMsgId(10001122L);
        dto.setFeedbackType("tread");
        dto.setFeedbackLabel(List.of("ANS_INACCURATE"));
        dto.setFeedbackContent("answer is not accurate");

        when(byaiMessageRelMapper.updateFeedbackByMessagePair(any())).thenReturn(1);

        service.updateFeedback(dto);

        ArgumentCaptor<ByaiMessageRel> captor = ArgumentCaptor.forClass(ByaiMessageRel.class);
        verify(byaiMessageRelMapper, never()).updateFeedbackByRelId(any());
        verify(byaiMessageRelMapper).updateFeedbackByMessagePair(captor.capture());
        ByaiMessageRel update = captor.getValue();
        assertThat(update.getAskMsgId()).isEqualTo(10001120L);
        assertThat(update.getResMsgId()).isEqualTo(10001122L);
        assertThat(update.getFeedbackType()).isEqualTo("tread");
        assertThat(update.getFeedbackLabel()).isEqualTo("[\"ANS_INACCURATE\"]");
        assertThat(update.getFeedbackContent()).isEqualTo("answer is not accurate");
    }

    @Test
    void updateFeedback_whenRelIdUpdateMisses_fallsBackToMessagePair() {
        ByaiMessageRelObjDto dto = new ByaiMessageRelObjDto();
        dto.setRelId(10L);
        dto.setAskMsgId(10001120L);
        dto.setResMsgId(10001122L);
        dto.setFeedbackType("praise");

        when(byaiMessageRelMapper.updateFeedbackByRelId(any())).thenReturn(0);
        when(byaiMessageRelMapper.updateFeedbackByMessagePair(any())).thenReturn(1);

        service.updateFeedback(dto);

        verify(byaiMessageRelMapper).updateFeedbackByRelId(any());
        verify(byaiMessageRelMapper).updateFeedbackByMessagePair(any());
    }

    @Test
    void searchMem_convertsDateFieldsToLocalDateTime() {
        LocalDateTime createTime = LocalDateTime.of(2026, 5, 8, 12, 8, 0);
        LocalDateTime askTime = LocalDateTime.of(2026, 5, 8, 12, 7, 58);
        LocalDateTime resTime = LocalDateTime.of(2026, 5, 8, 12, 8, 1);
        LocalDateTime feedbackTime = LocalDateTime.of(2026, 5, 8, 12, 9, 0);
        ByaiMessageRel rel = new ByaiMessageRel();
        rel.setAskMsgId(10001120L);
        rel.setResMsgId(10001122L);
        rel.setCreateTime(toDate(createTime));
        rel.setAskTime(toDate(askTime));
        rel.setResTime(toDate(resTime));
        rel.setFeedbackTime(toDate(feedbackTime));

        when(byaiMessageRelMapper.selectSearchMemPage(any())).thenReturn(List.of(rel));

        MemRelSearchRequestDto request = new MemRelSearchRequestDto();
        PageResult<MemRelSearchReponseDto> result = service.searchMem(request);

        MemRelSearchReponseDto dto = result.getList().get(0);
        assertThat(dto.getCreateTime()).isEqualTo(createTime);
        assertThat(dto.getAskTime()).isEqualTo(askTime);
        assertThat(dto.getResTime()).isEqualTo(resTime);
        assertThat(dto.getFeedbackTime()).isEqualTo(feedbackTime);
    }

    private Date toDate(LocalDateTime value) {
        return Date.from(value.atZone(ZoneId.systemDefault()).toInstant());
    }
}
