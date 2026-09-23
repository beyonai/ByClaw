package com.iwhalecloud.byai.manager.domain.users.service;

import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.users.UsersMapper;
import java.util.List;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class PhoneAccountLookupTest {

    @Test
    void lookupIncludesLegacyPlaintextEncryptedAndInactiveAccounts() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), Users.class);
        UsersMapper mapper = mock(UsersMapper.class);
        Users legacy = new Users();
        legacy.setPhone("13800138000");
        Users encrypted = new Users();
        encrypted.setPhone(Sm4Util.encrypt("13800138000"));
        when(mapper.selectList(any())).thenReturn(List.of(legacy, encrypted));
        UserService service = new UserService();
        ReflectionTestUtils.setField(service, "usersMapper", mapper);

        assertThat(service.findAllByUserPhone("13800138000"))
            .containsExactly(legacy, encrypted);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Wrapper<Users>> query = ArgumentCaptor.forClass(Wrapper.class);
        verify(mapper).selectList(query.capture());
        @SuppressWarnings("unchecked")
        LambdaQueryWrapper<Users> condition = (LambdaQueryWrapper<Users>) query.getValue();
        assertThat(condition.getSqlSegment()).doesNotContain("state");
        assertThat(condition.getParamNameValuePairs().values())
            .contains("13800138000", Sm4Util.encrypt("13800138000"));
    }
}
