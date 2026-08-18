package com.iwhalecloud.byai.manager.domain.users.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.manager.domain.event.user.UserOrganizationChangedEvent;
import com.iwhalecloud.byai.manager.entity.users.UsersOrganization;
import com.iwhalecloud.byai.manager.mapper.users.UsersOrganizationMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

class UsersOrganizationServiceTest {

    @Test
    void saveBatch_publishesDistinctAffectedUsersForAuthRefresh() {
        UsersOrganizationService service = new UsersOrganizationService();
        UsersOrganizationMapper mapper = mock(UsersOrganizationMapper.class);
        SequenceService sequenceService = mock(SequenceService.class);
        ApplicationEventPublisher eventPublisher = mock(ApplicationEventPublisher.class);
        ReflectionTestUtils.setField(service, "usersOrganizationMapper", mapper);
        ReflectionTestUtils.setField(service, "SequenceService", sequenceService);
        ReflectionTestUtils.setField(service, "eventPublisher", eventPublisher);
        when(sequenceService.nextVal()).thenReturn(1L, 2L);

        UsersOrganization firstRole = new UsersOrganization();
        firstRole.setUserId(1001L);
        UsersOrganization secondRole = new UsersOrganization();
        secondRole.setUserId(1001L);

        service.saveBatch(List.of(firstRole, secondRole));

        verify(eventPublisher).publishEvent(argThat(event -> event instanceof UserOrganizationChangedEvent
            && ((UserOrganizationChangedEvent) event).getUserIds().equals(java.util.Set.of(1001L))));
        assertThat(firstRole.getId()).isEqualTo(1L);
        assertThat(secondRole.getId()).isEqualTo(2L);
    }

    @Test
    void removeByPrimaryKeys_publishesAffectedUsersForAuthRefresh() {
        UsersOrganizationService service = new UsersOrganizationService();
        UsersOrganizationMapper mapper = mock(UsersOrganizationMapper.class);
        ApplicationEventPublisher eventPublisher = mock(ApplicationEventPublisher.class);
        ReflectionTestUtils.setField(service, "usersOrganizationMapper", mapper);
        ReflectionTestUtils.setField(service, "eventPublisher", eventPublisher);

        UsersOrganization firstUser = new UsersOrganization();
        firstUser.setId(1L);
        firstUser.setUserId(1001L);
        UsersOrganization secondUser = new UsersOrganization();
        secondUser.setId(2L);
        secondUser.setUserId(1002L);
        when(mapper.selectBatchIds(List.of(1L, 2L))).thenReturn(List.of(firstUser, secondUser));

        service.removeByPrimaryKeys(List.of(1L, 2L));

        verify(eventPublisher).publishEvent(argThat(event -> event instanceof UserOrganizationChangedEvent
            && ((UserOrganizationChangedEvent) event).getUserIds().equals(java.util.Set.of(1001L, 1002L))));
    }
}
