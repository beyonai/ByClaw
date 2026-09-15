package com.iwhalecloud.byai.state.domain.groupchat.application;

import com.iwhalecloud.byai.common.ecrypt.RsaEncrypt;
import com.iwhalecloud.byai.common.ecrypt.RsaDecrypt;
import org.springframework.stereotype.Component;

/** 复用账号密码的 RSA 算法及 byclaw.rsa 公私钥配置，不记录凭证。 */
@Component
public class GroupChatInvitationTokenCipher {
    public String encrypt(String token) {
        String encrypted = RsaEncrypt.encrypt(token);
        if (encrypted == null || encrypted.isBlank()) throw new IllegalStateException("Invitation encryption failed");
        return encrypted;
    }

    public String decrypt(String encrypted) {
        String token = RsaDecrypt.decrypt(encrypted);
        if (token == null || !token.matches("[A-Za-z0-9]{8}")) {
            throw new IllegalStateException("Invitation decryption failed");
        }
        return token;
    }
}
