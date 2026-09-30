package com.iwhalecloud.byai.manager.application.service.conversation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.constants.users.UserType;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.login.bean.UsersOrganization;
import com.iwhalecloud.byai.common.message.dto.MemRelSearchRequestDto;
import com.iwhalecloud.byai.common.message.dto.PageResult;
import com.iwhalecloud.byai.common.message.service.ByaiMessageRelObjService;
import com.iwhalecloud.byai.manager.entity.staticdata.ByaiSystemConfig;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.staticdata.ByaiSystemConfigMapper;
import com.iwhalecloud.byai.manager.mapper.users.UsersMapper;
import com.iwhalecloud.byai.manager.qo.conversation.ConversationSearchQo;
import java.time.LocalDateTime;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

class ConversationSearchSkillServiceTest {

    private final ByaiSystemConfigMapper configs = mock(ByaiSystemConfigMapper.class);
    private final UsersMapper users = mock(UsersMapper.class);
    private final ByaiMessageRelObjService messages = mock(ByaiMessageRelObjService.class);
    private final ConversationSearchSkillService service =
        new ConversationSearchSkillService(configs, users, messages, new ObjectMapper());

    @BeforeEach
    void setUp() {
        login("auditor");
    }

    @AfterEach
    void cleanUp() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void anonymousCallerNeverReadsConfigurationOrMessages() {
        CurrentUserHolder.clearLoginInfo();
        assertDenied(new ConversationSearchQo());
        verifyNoInteractions(configs, users, messages);
    }

    @ParameterizedTest
    @NullSource
    @ValueSource(strings = {"", "[]", "null", "{}", "auditor", "[\"other\"]", "[\"AUDITOR\"]",
        "[\"auditor-extra\"]", "[\"auditor\",null]", "[\"auditor\",123]", "[\"auditor\",\"\"]",
        "[\"auditor\",\"*\"]", "[\"auditor\"] []", "[\"auditor\""})
    void missingMalformedOrNonmatchingAllowlistDeniesWithoutDataAccess(String value) {
        configure(value);
        assertDenied(new ConversationSearchQo());
        verifyNoInteractions(users, messages);
    }

    @Test
    void duplicateConfigurationFailsClosed() {
        ByaiSystemConfig config = new ByaiSystemConfig();
        config.setParamValue("[\"auditor\"]");
        when(configs.selectList(any())).thenReturn(List.of(config, config));
        assertDenied(new ConversationSearchQo());
        verifyNoInteractions(users, messages);
    }

    @Test
    void databaseFailureCannotFallBackToCachedAuthorization() {
        when(configs.selectList(any())).thenThrow(new IllegalStateException("database unavailable"));
        assertThatThrownBy(() -> service.search(new ConversationSearchQo())).isInstanceOf(IllegalStateException.class);
        verifyNoInteractions(users, messages);
    }

    @Test
    void targetUserAndAdminRoleCannotAuthorizeTheCaller() {
        configure("[\"allowed-target\"]");
        UsersOrganization role = new UsersOrganization();
        role.setUserType(UserType.PLAT_MAN);
        CurrentUserHolder.getLoginInfo().setUsersOrganizations(List.of(role));
        ConversationSearchQo query = new ConversationSearchQo();
        query.setUserCode("allowed-target");
        query.setDigitalEmployeeId(123L);
        assertDenied(query);
        verifyNoInteractions(users, messages);
    }

    @Test
    void revocationTakesEffectOnTheNextPage() {
        configure("[\"auditor\"]");
        service.search(new ConversationSearchQo());
        configure("[]");
        ConversationSearchQo nextPage = new ConversationSearchQo();
        nextPage.setPageNum(2);
        assertDenied(nextPage);
        verify(configs, times(2)).selectList(any());
        verify(messages).searchMem(any());
    }

    @Test
    void allowedOrdinaryUserCanSearchAllRecordsWithoutEmployeeGrantFiltering() {
        configure("[\" auditor \",\"another\"]");
        service.search(new ConversationSearchQo());
        MemRelSearchRequestDto query = capturedQuery();
        assertThat(query.getAskObjIds()).isNull();
        assertThat(query.getResObjIds()).isNull();
        assertThat(query.getSessionIds()).isNull();
        assertThat(query.getComAcctIds()).isNull();
        assertThat(query.getPageSize()).isEqualTo(20);
        verifyNoInteractions(users);
    }

    @Test
    void combinesUserEmployeeTimeAndLiteralContentFilters() {
        configure("[\"auditor\"]");
        Users target = new Users();
        target.setUserId(45L);
        when(users.selectList(any())).thenReturn(List.of(target));
        ConversationSearchQo query = new ConversationSearchQo();
        query.setUserCode("target");
        query.setDigitalEmployeeId(123L);
        query.setStartTime(LocalDateTime.of(2026, 9, 1, 0, 0));
        query.setEndTime(LocalDateTime.of(2026, 9, 29, 23, 59));
        query.setKeyword("预算_50%\\资料");
        query.setPageNum(2);
        query.setPageSize(100);
        service.search(query);
        MemRelSearchRequestDto request = capturedQuery();
        assertThat(request.getAskObjIds()).containsExactly(45L);
        assertThat(request.getAskObjTypes()).containsExactly("HUMAN");
        assertThat(request.getResObjIds()).containsExactly(123L);
        assertThat(request.getResObjTypes()).containsExactly("AGENT");
        assertThat(request.getAskTimeRange()).containsExactly(query.getStartTime(), query.getEndTime());
        assertThat(request.getKeyword()).isEqualTo("预算\\_50\\%\\\\资料");
        assertThat(request.getPageNum()).isEqualTo(2);
        assertThat(request.getPageSize()).isEqualTo(100);
    }

    @Test
    void unknownUserReturnsEmptyPageWithoutBroadeningSearch() {
        configure("[\"auditor\"]");
        when(users.selectList(any())).thenReturn(List.of());
        ConversationSearchQo query = new ConversationSearchQo();
        query.setUserCode("unknown");
        PageResult<?> result = service.search(query);
        assertThat(result.getTotal()).isZero();
        assertThat(result.getList()).isEmpty();
        verifyNoInteractions(messages);
    }

    @Test
    void preservesSingleSidedTimeRange() {
        configure("[\"auditor\"]");
        ConversationSearchQo query = new ConversationSearchQo();
        query.setEndTime(LocalDateTime.of(2026, 9, 1, 0, 0));
        service.search(query);
        assertThat(capturedQuery().getAskTimeRange()).containsExactly(null, query.getEndTime());
    }

    @Test
    void rejectsInvalidPaginationBlankFiltersAndReversedRange() {
        configure("[\"auditor\"]");
        ConversationSearchQo pageZero = new ConversationSearchQo();
        pageZero.setPageNum(0);
        ConversationSearchQo nullSize = new ConversationSearchQo();
        nullSize.setPageSize(null);
        ConversationSearchQo oversize = new ConversationSearchQo();
        oversize.setPageSize(101);
        ConversationSearchQo blankUser = new ConversationSearchQo();
        blankUser.setUserCode(" ");
        ConversationSearchQo blankKeyword = new ConversationSearchQo();
        blankKeyword.setKeyword(" ");
        ConversationSearchQo reversed = new ConversationSearchQo();
        reversed.setStartTime(LocalDateTime.of(2026, 9, 2, 0, 0));
        reversed.setEndTime(LocalDateTime.of(2026, 9, 1, 0, 0));
        for (ConversationSearchQo query : List.of(pageZero, nullSize, oversize, blankUser, blankKeyword, reversed)) {
            assertThatThrownBy(() -> service.search(query)).isInstanceOfSatisfying(ResponseStatusException.class,
                ex -> assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST));
        }
        verifyNoInteractions(users, messages);
    }

    private void configure(String value) {
        ByaiSystemConfig config = new ByaiSystemConfig();
        config.setParamValue(value);
        when(configs.selectList(any())).thenReturn(value == null ? List.of() : List.of(config));
    }

    private void login(String code) {
        LoginInfo login = new LoginInfo();
        login.setUserCode(code);
        login.setUserId(1L);
        CurrentUserHolder.setLoginInfo(login);
    }

    private void assertDenied(ConversationSearchQo query) {
        assertThatThrownBy(() -> service.search(query)).isInstanceOfSatisfying(ResponseStatusException.class,
            ex -> assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN));
    }

    private MemRelSearchRequestDto capturedQuery() {
        ArgumentCaptor<MemRelSearchRequestDto> captor = ArgumentCaptor.forClass(MemRelSearchRequestDto.class);
        verify(messages).searchMem(captor.capture());
        return captor.getValue();
    }
}
