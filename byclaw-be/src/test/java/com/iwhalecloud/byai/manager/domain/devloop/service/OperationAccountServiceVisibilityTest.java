package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.iwhalecloud.byai.manager.entity.devloop.OperationAccount;
import com.iwhalecloud.byai.manager.mapper.devloop.OperationAccountMapper;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class OperationAccountServiceVisibilityTest {

    private OperationAccountMapper operationAccountMapper;
    private OperationAccountService service;

    @BeforeEach
    void setUp() {
        if (TableInfoHelper.getTableInfo(OperationAccount.class) == null) {
            TableInfoHelper.initTableInfo(
                new MapperBuilderAssistant(new MybatisConfiguration(), ""), OperationAccount.class);
        }
        operationAccountMapper = mock(OperationAccountMapper.class);
        service = new OperationAccountService();
        ReflectionTestUtils.setField(service, "operationAccountMapper", operationAccountMapper);
    }

    @Test
    void listsOnlyCurrentUsersAccountsAndLegacyAccountsWithoutCreator() {
        List<OperationAccount> expected = List.of(new OperationAccount());
        when(operationAccountMapper.selectList(any())).thenReturn(expected);

        List<OperationAccount> actual = service.listAccessibleByProjectId(100L, 10L);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Wrapper<OperationAccount>> captor = ArgumentCaptor.forClass(Wrapper.class);
        verify(operationAccountMapper).selectList(captor.capture());
        assertThat(actual).isSameAs(expected);
        assertThat(captor.getValue()).isInstanceOf(LambdaQueryWrapper.class);

        LambdaQueryWrapper<OperationAccount> query = (LambdaQueryWrapper<OperationAccount>) captor.getValue();
        String sql = query.getSqlSegment();
        assertThat(sql).contains("project_id", "status_cd", "(create_by =", "OR create_by IS NULL)",
            "ORDER BY create_time DESC");
        assertThat(query.getParamNameValuePairs().values()).containsExactlyInAnyOrder(100L, "00A", 10L);
    }

    @Test
    void returnsEmptyListForMissingProjectOrUserWithoutQueryingMapper() {
        assertThat(service.listAccessibleByProjectId(null, 10L)).isEmpty();
        assertThat(service.listAccessibleByProjectId(100L, null)).isEmpty();

        verifyNoInteractions(operationAccountMapper);
    }

    @Test
    void listsAllActiveAccountsCreatedByCurrentUserIncludingProjectAccounts() {
        List<OperationAccount> expected = List.of(new OperationAccount());
        when(operationAccountMapper.selectList(any())).thenReturn(expected);

        List<OperationAccount> actual = service.listGlobalByUserId(10L);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Wrapper<OperationAccount>> captor = ArgumentCaptor.forClass(Wrapper.class);
        verify(operationAccountMapper).selectList(captor.capture());
        assertThat(actual).isSameAs(expected);

        LambdaQueryWrapper<OperationAccount> query = (LambdaQueryWrapper<OperationAccount>) captor.getValue();
        assertThat(query.getSqlSegment()).contains("create_by =", "status_cd", "ORDER BY create_time DESC")
            .doesNotContain("project_id IS NULL");
        assertThat(query.getParamNameValuePairs().values()).containsExactlyInAnyOrder(10L, "00A");
    }

    @Test
    void returnsEmptyGlobalListForMissingUserWithoutQueryingMapper() {
        assertThat(service.listGlobalByUserId(null)).isEmpty();

        verifyNoInteractions(operationAccountMapper);
    }

    @Test
    void findsUserLevelTemplateHistoryIncludingSoftDeletedRows() {
        OperationAccount deleted = new OperationAccount();
        deleted.setConfig("{\"connectorCode\":\"weixin-official-web\"}");
        deleted.setStatusCd("00X");
        when(operationAccountMapper.selectList(any())).thenReturn(List.of(deleted));

        assertThat(service.hasGlobalTemplateHistory(10L, "weixin-official-web")).isTrue();

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Wrapper<OperationAccount>> captor = ArgumentCaptor.forClass(Wrapper.class);
        verify(operationAccountMapper).selectList(captor.capture());
        LambdaQueryWrapper<OperationAccount> query = (LambdaQueryWrapper<OperationAccount>) captor.getValue();
        assertThat(query.getSqlSegment()).contains("create_by =", "project_id IS NULL").doesNotContain("status_cd");
    }

    @Test
    void ignoresOrdinaryCustomLinksWhenFindingTemplateHistory() {
        OperationAccount ordinary = new OperationAccount();
        ordinary.setConfig("{}");
        ordinary.setCustomUrl("https://mp.weixin.qq.com/");
        when(operationAccountMapper.selectList(any())).thenReturn(List.of(ordinary));

        assertThat(service.hasGlobalTemplateHistory(10L, "weixin-official-web")).isFalse();
    }
}
