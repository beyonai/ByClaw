package com.iwhalecloud.byai.manager.domain.connector.provider.weixinopen;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Base64;

import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;

import org.junit.jupiter.api.Test;

class WeixinOpenPlatformCryptoTest {
    private static final String TOKEN = "callback-token";
    private static final byte[] AES_KEY = "0123456789abcdef0123456789abcdef".getBytes(StandardCharsets.US_ASCII);
    private static final String ENCODING_KEY = Base64.getEncoder().withoutPadding().encodeToString(AES_KEY);

    @Test
    void verifiesSignatureAndDecryptsOfficialMessageEnvelope() throws Exception {
        String xml = "<xml><AppId>wx-component</AppId><InfoType>component_verify_ticket</InfoType>"
            + "<ComponentVerifyTicket>ticket-value</ComponentVerifyTicket><CreateTime>100</CreateTime></xml>";
        String encrypted = encrypt(xml, "wx-component");
        String timestamp = "100";
        String nonce = "nonce";
        String signature = signature(TOKEN, timestamp, nonce, encrypted);

        WeixinOpenPlatformCrypto crypto = new WeixinOpenPlatformCrypto();

        assertThat(crypto.verifyAndDecrypt(
            TOKEN, ENCODING_KEY, "wx-component", signature, timestamp, nonce, encrypted)).isEqualTo(xml);
    }

    @Test
    void rejectsSignatureAndAppidMismatch() throws Exception {
        String encrypted = encrypt("<xml/>", "wx-component");
        WeixinOpenPlatformCrypto crypto = new WeixinOpenPlatformCrypto();

        assertThatThrownBy(() -> crypto.verifyAndDecrypt(
            TOKEN, ENCODING_KEY, "wx-component", "bad", "100", "nonce", encrypted))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> crypto.verifyAndDecrypt(
            TOKEN, ENCODING_KEY, "wx-other", signature(TOKEN, "100", "nonce", encrypted),
            "100", "nonce", encrypted))
            .isInstanceOf(IllegalArgumentException.class);
    }

    private String encrypt(String xml, String appid) throws Exception {
        byte[] random = "0123456789abcdef".getBytes(StandardCharsets.US_ASCII);
        byte[] message = xml.getBytes(StandardCharsets.UTF_8);
        byte[] target = appid.getBytes(StandardCharsets.UTF_8);
        ByteBuffer plain = ByteBuffer.allocate(random.length + 4 + message.length + target.length + 32);
        plain.put(random).putInt(message.length).put(message).put(target);
        int used = plain.position();
        int padding = 32 - (used % 32);
        for (int index = 0; index < padding; index++) plain.put((byte) padding);
        byte[] padded = Arrays.copyOf(plain.array(), used + padding);
        Cipher cipher = Cipher.getInstance("AES/CBC/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(AES_KEY, "AES"),
            new IvParameterSpec(Arrays.copyOf(AES_KEY, 16)));
        return Base64.getEncoder().encodeToString(cipher.doFinal(padded));
    }

    private String signature(String... values) throws Exception {
        Arrays.sort(values);
        return java.util.HexFormat.of().formatHex(
            MessageDigest.getInstance("SHA-1").digest(String.join("", values).getBytes(StandardCharsets.UTF_8)));
    }
}
