package com.iwhalecloud.byai.manager.domain.login.service;

import com.iwhalecloud.byai.manager.entity.login.SafeAccountMsg;
import com.iwhalecloud.byai.manager.mapper.login.SafeAccountMsgMapper;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class SafeAccountMsgServiceTest {
    @Test
    void requiresExactlyOnePersistedRecord() {
        SafeAccountMsgMapper mapper = mock(SafeAccountMsgMapper.class);
        SafeAccountMsgService service = new SafeAccountMsgService();
        ReflectionTestUtils.setField(service, "safeAccountMsgMapper", mapper);
        SafeAccountMsg record = new SafeAccountMsg();
        when(mapper.insert(record)).thenReturn(0, 1);
        assertThatThrownBy(() -> service.save(record)).isInstanceOf(IllegalStateException.class);
        assertThatCode(() -> service.save(record)).doesNotThrowAnyException();
    }

    @Test
    void requiresExactlyOneUpdatedRecord() {
        SafeAccountMsgMapper mapper = mock(SafeAccountMsgMapper.class);
        SafeAccountMsgService service = new SafeAccountMsgService();
        ReflectionTestUtils.setField(service, "safeAccountMsgMapper", mapper);
        SafeAccountMsg record = new SafeAccountMsg();
        when(mapper.updateById(record)).thenReturn(0, 1);
        assertThatThrownBy(() -> service.update(record)).isInstanceOf(IllegalStateException.class);
        assertThatCode(() -> service.update(record)).doesNotThrowAnyException();
    }
}
