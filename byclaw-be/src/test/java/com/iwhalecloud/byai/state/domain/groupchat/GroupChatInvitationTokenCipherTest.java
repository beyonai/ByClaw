package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import org.junit.jupiter.api.Test;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPublicKey;
import java.security.interfaces.RSAPrivateKey;
import com.iwhalecloud.byai.common.web.ApplicationContextUtil;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatInvitationTokenCipher;

class GroupChatInvitationTokenCipherTest {
    @Test void reusesAccountRsaConfigurationForRoundTrip() throws Exception {
        var generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        var pair = generator.generateKeyPair();
        var publicKey = (RSAPublicKey) pair.getPublic();
        var privateKey = (RSAPrivateKey) pair.getPrivate();
        var previous = (org.springframework.context.ApplicationContext)
            org.springframework.test.util.ReflectionTestUtils.getField(ApplicationContextUtil.class, "applicationContext");
        var context = mock(org.springframework.context.ApplicationContext.class);
        var environment = new org.springframework.mock.env.MockEnvironment()
            .withProperty("byclaw.rsa.modules", publicKey.getModulus().toString())
            .withProperty("byclaw.rsa.public-key", publicKey.getPublicExponent().toString())
            .withProperty("byclaw.rsa.private-key", privateKey.getPrivateExponent().toString());
        when(context.getEnvironment()).thenReturn(environment);
        new ApplicationContextUtil().setApplicationContext(context);
        try {
            var cipher = new GroupChatInvitationTokenCipher();
            String encrypted = cipher.encrypt("Ab1234Cd");
            assertThat(encrypted).doesNotContain("Ab1234Cd");
            assertThat(cipher.decrypt(encrypted)).isEqualTo("Ab1234Cd");
        } finally {
            new ApplicationContextUtil().setApplicationContext(previous);
        }
    }
}
