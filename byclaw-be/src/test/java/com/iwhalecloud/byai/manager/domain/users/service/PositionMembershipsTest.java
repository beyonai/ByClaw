package com.iwhalecloud.byai.manager.domain.users.service;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.domain.event.user.UserOrganizationChangedEvent;
import com.iwhalecloud.byai.manager.entity.users.UsersOrganization;
import com.iwhalecloud.byai.manager.mapper.users.UsersOrganizationMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.support.StaticMessageSource;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class PositionMembershipsTest {

    private final UsersOrganizationService service = new UsersOrganizationService();
    private final UsersOrganizationMapper mapper = mock(UsersOrganizationMapper.class);
    private final SequenceService sequence = mock(SequenceService.class);
    private final ApplicationEventPublisher events = mock(ApplicationEventPublisher.class);
    private Object originalMessages;

    @BeforeEach
    void setUp() {
        if (TableInfoHelper.getTableInfo(UsersOrganization.class) == null) {
            TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""),
                UsersOrganization.class);
        }
        originalMessages = ReflectionTestUtils.getField(I18nUtil.class, "messageSource");
        StaticMessageSource messages = new StaticMessageSource();
        messages.setUseCodeAsDefaultMessage(true);
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messages);
        ReflectionTestUtils.setField(service, "usersOrganizationMapper", mapper);
        ReflectionTestUtils.setField(service, "SequenceService", sequence);
        ReflectionTestUtils.setField(service, "eventPublisher", events);
        when(sequence.nextVal()).thenReturn(101L, 102L);
    }

    @AfterEach
    void tearDown() {
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", originalMessages);
    }

    @Test
    void addingPreservesOtherPositionsAndAllExistingOrganizationRoles() {
        when(mapper.selectList(any(Wrapper.class))).thenReturn(List.of(
            relation(1L, 7L, 20L, "ORD_USER", 90L),
            relation(2L, 7L, 20L, "ORG_MAN", 90L)));
        service.addPositionUsers(10L, List.of(7L));

        ArgumentCaptor<List<UsersOrganization>> additions = ArgumentCaptor.forClass(List.class);
        verify(mapper).saveBatch(additions.capture());
        assertThat(additions.getValue()).extracting(UsersOrganization::getPositionId).containsOnly(10L);
        assertThat(additions.getValue()).extracting(UsersOrganization::getOrgId).containsOnly(20L);
        assertThat(additions.getValue()).extracting(UsersOrganization::getUserType)
            .containsExactlyInAnyOrder("ORD_USER", "ORG_MAN");
        verify(mapper, never()).update(any(), any(Wrapper.class));
        verify(mapper, never()).delete(any(Wrapper.class));
        ArgumentCaptor<UserOrganizationChangedEvent> event = ArgumentCaptor.forClass(UserOrganizationChangedEvent.class);
        verify(events).publishEvent(event.capture());
        assertThat(event.getValue().getUserIds()).containsExactly(7L);
    }

    @Test
    void addingAnExistingAssociationIsANoop() {
        when(mapper.selectList(any(Wrapper.class))).thenReturn(List.of(relation(1L, 7L, 20L, "ORD_USER", 10L)));
        service.addPositionUsers(10L, List.of(7L));
        verify(mapper, never()).saveBatch(anyList());
        verify(mapper, never()).update(any(), any(Wrapper.class));
        verifyNoInteractions(events);
    }

    @Test
    void addingReusesAnUnassignedOrganizationRole() {
        when(mapper.selectList(any(Wrapper.class))).thenReturn(List.of(relation(1L, 7L, 20L, "ORD_USER", null)));
        service.addPositionUsers(10L, List.of(7L));
        ArgumentCaptor<LambdaUpdateWrapper<UsersOrganization>> update = ArgumentCaptor.forClass(LambdaUpdateWrapper.class);
        verify(mapper).update(isNull(), update.capture());
        assertThat(update.getValue().getSqlSet()).startsWith("position_id=").doesNotContain("user_type", "org_id");
        assertThat(update.getValue().getSqlSegment()).contains("id =");
        assertThat(update.getValue().getParamNameValuePairs().values()).contains(1L, 10L);
        verify(mapper, never()).saveBatch(anyList());
    }

    @Test
    void missingOrganizationAbortsTheBatchBeforeAnyWrites() {
        when(mapper.selectList(any(Wrapper.class))).thenReturn(List.of(relation(1L, 7L, 20L, "ORD_USER", 90L)));
        assertThatThrownBy(() -> service.addPositionUsers(10L, List.of(7L, 8L))).isInstanceOf(BaseException.class);
        verify(mapper, never()).saveBatch(anyList());
        verify(mapper, never()).update(any(), any(Wrapper.class));
        verifyNoInteractions(events);
    }

    @Test
    void removalClearsOnlyTheRequestedPositionForTheSelectedUsers() {
        when(mapper.update(isNull(), any(Wrapper.class))).thenReturn(2);
        service.removePositionUsers(10L, List.of(7L, 8L));
        ArgumentCaptor<LambdaUpdateWrapper<UsersOrganization>> update = ArgumentCaptor.forClass(LambdaUpdateWrapper.class);
        verify(mapper).update(isNull(), update.capture());
        assertThat(update.getValue().getSqlSet()).startsWith("position_id=").doesNotContain("org_id", "user_type");
        assertThat(update.getValue().getSqlSegment()).contains("position_id =", "user_id IN");
        assertThat(update.getValue().getParamNameValuePairs().values()).contains(10L, 7L, 8L, null);
        verify(mapper, never()).delete(any(Wrapper.class));
        ArgumentCaptor<UserOrganizationChangedEvent> event = ArgumentCaptor.forClass(UserOrganizationChangedEvent.class);
        verify(events).publishEvent(event.capture());
        assertThat(event.getValue().getUserIds()).containsExactly(7L, 8L);
    }

    private UsersOrganization relation(Long id, Long userId, Long orgId, String role, Long positionId) {
        UsersOrganization relation = new UsersOrganization();
        relation.setId(id);
        relation.setUserId(userId);
        relation.setOrgId(orgId);
        relation.setUserType(role);
        relation.setPositionId(positionId);
        return relation;
    }
}
