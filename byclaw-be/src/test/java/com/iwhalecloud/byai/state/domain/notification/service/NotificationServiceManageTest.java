package com.iwhalecloud.byai.state.domain.notification.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Date;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.dto.notification.NotificationManageDto;
import com.iwhalecloud.byai.manager.dto.notification.NotificationQueryDto;
import com.iwhalecloud.byai.manager.entity.notification.ByaiNotification;
import com.iwhalecloud.byai.manager.mapper.notification.ByaiNotificationMapper;
import com.iwhalecloud.byai.manager.vo.notification.NotificationVO;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

class NotificationServiceManageTest {

    @Test
    void queryManagePageDelegatesToNotificationMapper() {
        NotificationService service = newService(mock(ByaiNotificationMapper.class), mock(SequenceService.class));
        ByaiNotificationMapper mapper = (ByaiNotificationMapper) ReflectionTestUtils.getField(service,
            "byaiNotificationMapper");
        Page<NotificationVO> page = new Page<>(1, 10);
        when(mapper.selectNotificationPage(any(), any())).thenReturn(page);

        NotificationQueryDto query = new NotificationQueryDto();
        query.setPageNum(1);
        query.setPageSize(10);
        query.setBizType((short) 2);

        Page<NotificationVO> result = service.queryManagePage(query);

        assertThat(result).isSameAs(page);
        verify(mapper).selectNotificationPage(any(Page.class), any(NotificationQueryDto.class));
    }

    @Test
    void createManageNotificationSetsDefaultsAndUsesExistingSave() {
        ByaiNotificationMapper mapper = mock(ByaiNotificationMapper.class);
        SequenceService sequenceService = mock(SequenceService.class);
        NotificationService service = newService(mapper, sequenceService);
        when(sequenceService.nextVal()).thenReturn(1001L);
        when(mapper.insert(any(ByaiNotification.class))).thenReturn(1);

        NotificationManageDto request = new NotificationManageDto();
        request.setTitle("v1.0.0");
        request.setContent("# Release");
        request.setBizType((short) 2);
        request.setPriority((short) 2);
        request.setExtraInfo("1.0.0");

        ByaiNotification result = service.createManageNotification(request);

        ArgumentCaptor<ByaiNotification> captor = ArgumentCaptor.forClass(ByaiNotification.class);
        verify(mapper).insert(captor.capture());
        ByaiNotification saved = captor.getValue();
        assertThat(saved.getId()).isEqualTo(1001L);
        assertThat(saved.getTitle()).isEqualTo("v1.0.0");
        assertThat(saved.getContent()).isEqualTo("# Release");
        assertThat(saved.getBizType()).isEqualTo((short) 2);
        assertThat(saved.getPriority()).isEqualTo((short) 2);
        assertThat(saved.getExtraInfo()).isEqualTo("1.0.0");
        assertThat(saved.getIsRead()).isEqualTo("0");
        assertThat(saved.getIsDeleted()).isEqualTo("0");
        assertThat(saved.getCreateTime()).isNotNull();
        assertThat(result).isSameAs(saved);
    }

    @Test
    void createVersionManageNotificationDoesNotSetDefaultPriority() {
        ByaiNotificationMapper mapper = mock(ByaiNotificationMapper.class);
        SequenceService sequenceService = mock(SequenceService.class);
        NotificationService service = newService(mapper, sequenceService);
        when(sequenceService.nextVal()).thenReturn(1002L);
        when(mapper.insert(any(ByaiNotification.class))).thenReturn(1);

        NotificationManageDto request = new NotificationManageDto();
        request.setTitle("v1.0.0");
        request.setContent("# Release");
        request.setBizType((short) 2);

        service.createManageNotification(request);

        ArgumentCaptor<ByaiNotification> captor = ArgumentCaptor.forClass(ByaiNotification.class);
        verify(mapper).insert(captor.capture());
        assertThat(captor.getValue().getPriority()).isNull();
    }

    @Test
    void createSystemManageNotificationDoesNotSetReadState() {
        ByaiNotificationMapper mapper = mock(ByaiNotificationMapper.class);
        SequenceService sequenceService = mock(SequenceService.class);
        NotificationService service = newService(mapper, sequenceService);
        when(sequenceService.nextVal()).thenReturn(1003L);
        when(mapper.insert(any(ByaiNotification.class))).thenReturn(1);

        NotificationManageDto request = new NotificationManageDto();
        request.setTitle("系统通知");
        request.setContent("通知内容");
        request.setBizType((short) 0);
        request.setPriority((short) 2);

        service.createManageNotification(request);

        ArgumentCaptor<ByaiNotification> captor = ArgumentCaptor.forClass(ByaiNotification.class);
        verify(mapper).insert(captor.capture());
        assertThat(captor.getValue().getIsRead()).isNull();
    }

    @Test
    void updateManageNotificationKeepsStateFieldsAndUpdatesEditableFields() {
        ByaiNotificationMapper mapper = mock(ByaiNotificationMapper.class);
        NotificationService service = newService(mapper, mock(SequenceService.class));
        ByaiNotification existing = new ByaiNotification();
        existing.setId(1001L);
        existing.setIsRead("1");
        existing.setIsDeleted("0");
        existing.setCreateTime(new Date(1L));
        when(mapper.selectById(1001L)).thenReturn(existing);
        when(mapper.updateById(any(ByaiNotification.class))).thenReturn(1);

        NotificationManageDto request = new NotificationManageDto();
        request.setId(1001L);
        request.setTitle("Updated");
        request.setContent("Body");
        request.setBizType((short) 0);
        request.setPriority((short) 3);

        ByaiNotification result = service.updateManageNotification(request);

        ArgumentCaptor<ByaiNotification> captor = ArgumentCaptor.forClass(ByaiNotification.class);
        verify(mapper).updateById(captor.capture());
        ByaiNotification updated = captor.getValue();
        assertThat(updated.getTitle()).isEqualTo("Updated");
        assertThat(updated.getContent()).isEqualTo("Body");
        assertThat(updated.getBizType()).isEqualTo((short) 0);
        assertThat(updated.getPriority()).isEqualTo((short) 3);
        assertThat(updated.getIsRead()).isEqualTo("1");
        assertThat(updated.getIsDeleted()).isEqualTo("0");
        assertThat(result).isSameAs(updated);
    }

    @Test
    void deleteManageNotificationUsesLogicalDelete() {
        ByaiNotificationMapper mapper = mock(ByaiNotificationMapper.class);
        NotificationService service = newService(mapper, mock(SequenceService.class));
        when(mapper.updateById(any(ByaiNotification.class))).thenReturn(1);

        boolean result = service.deleteManageNotification(1001L);

        ArgumentCaptor<ByaiNotification> captor = ArgumentCaptor.forClass(ByaiNotification.class);
        verify(mapper).updateById(captor.capture());
        assertThat(captor.getValue().getId()).isEqualTo(1001L);
        assertThat(captor.getValue().getIsDeleted()).isEqualTo("1");
        assertThat(result).isTrue();
    }

    @Test
    void getLatestVersionNotificationQueriesLatestVersionNotification() {
        ByaiNotificationMapper mapper = mock(ByaiNotificationMapper.class);
        NotificationService service = newService(mapper, mock(SequenceService.class));
        ByaiNotification latest = new ByaiNotification();
        latest.setId(1001L);
        latest.setBizType((short) 2);
        latest.setExtraInfo("1.0.0");
        when(mapper.selectOne(any())).thenReturn(latest);

        ByaiNotification result = service.getLatestVersionNotification();

        assertThat(result).isSameAs(latest);
        verify(mapper).selectOne(any());
    }

    @Test
    void manageDtoDoesNotExposeUnusedNotificationDeliveryFields() {
        assertThrows(NoSuchFieldException.class,
            () -> NotificationManageDto.class.getDeclaredField("targetId"));
        assertThrows(NoSuchFieldException.class,
            () -> NotificationManageDto.class.getDeclaredField("sendToChat"));
        assertThrows(NoSuchFieldException.class,
            () -> NotificationManageDto.class.getDeclaredField("resourceBizType"));
        assertThrows(NoSuchFieldException.class,
            () -> NotificationManageDto.class.getDeclaredField("resourceId"));
    }

    private NotificationService newService(ByaiNotificationMapper mapper, SequenceService sequenceService) {
        NotificationService service = new NotificationService();
        ReflectionTestUtils.setField(service, "byaiNotificationMapper", mapper);
        ReflectionTestUtils.setField(service, "sequenceService", sequenceService);
        return service;
    }
}
