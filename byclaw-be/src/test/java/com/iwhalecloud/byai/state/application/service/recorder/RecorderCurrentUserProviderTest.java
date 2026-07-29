package com.iwhalecloud.byai.state.application.service.recorder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.state.domain.recorder.model.RecorderOwner;

class RecorderCurrentUserProviderTest {

    private final RecorderCurrentUserProvider provider = new RecorderCurrentUserProvider();

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void requireCurrentReturnsExactHolderIdentity() {
        setLoginInfo(42L, "AbC_001");

        RecorderOwner owner = provider.requireCurrent();

        assertThat(owner.userId()).isEqualTo(42L);
        assertThat(owner.userCode()).isEqualTo("AbC_001");
    }

    @Test
    void requireCurrentDoesNotTrimUserCode() {
        setLoginInfo(42L, " AbC_001 ");

        RecorderOwner owner = provider.requireCurrent();

        assertThat(owner.userCode()).isEqualTo(" AbC_001 ");
    }

    @Test
    void ownerComparisonUsesBothExactValues() {
        RecorderOwner owner = new RecorderOwner(42L, "AbC_001");

        assertThat(owner.sameAs(new RecorderOwner(42L, "AbC_001"))).isTrue();
        assertThat(owner.sameAs(new RecorderOwner(42L, "abc_001"))).isFalse();
        assertThat(owner.sameAs(new RecorderOwner(43L, "AbC_001"))).isFalse();
        assertThat(owner.sameAs(null)).isFalse();
    }

    @Test
    void requireCurrentRejectsMissingLogin() {
        assertAuthenticationRequired();
    }

    @Test
    void requireCurrentRejectsNullUserId() {
        setLoginInfo(null, "AbC_001");

        assertAuthenticationRequired();
    }

    @Test
    void requireCurrentRejectsZeroUserId() {
        setLoginInfo(0L, "AbC_001");

        assertAuthenticationRequired();
    }

    @Test
    void requireCurrentRejectsNegativeUserId() {
        setLoginInfo(-1L, "AbC_001");

        assertAuthenticationRequired();
    }

    @Test
    void requireCurrentRejectsNullUserCode() {
        setLoginInfo(42L, null);

        assertAuthenticationRequired();
    }

    @Test
    void requireCurrentRejectsEmptyUserCode() {
        setLoginInfo(42L, "");

        assertAuthenticationRequired();
    }

    @Test
    void requireCurrentRejectsWhitespaceUserCode() {
        setLoginInfo(42L, " \t ");

        assertAuthenticationRequired();
    }

    private void assertAuthenticationRequired() {
        assertThatThrownBy(provider::requireCurrent)
            .isInstanceOfSatisfying(RecorderSaveException.class,
                exception -> assertThat(exception.getCode()).isEqualTo("authentication_required"));
    }

    private void setLoginInfo(Long userId, String userCode) {
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(userId);
        loginInfo.setUserCode(userCode);
        CurrentUserHolder.setLoginInfo(loginInfo);
    }
}
