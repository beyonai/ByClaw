package com.iwhalecloud.byai.manager.domain.connector.provider.weixinopen;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Base64;
import java.util.HexFormat;

import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;

import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

@Component
public class WeixinOpenPlatformCrypto {
    private static final int RANDOM_PREFIX_BYTES = 16;
    private static final int MAX_ENCRYPTED_BYTES = 1024 * 1024;

    public String verifyAndDecrypt(
            String token,
            String encodingAesKey,
            String expectedComponentAppid,
            String signature,
            String timestamp,
            String nonce,
            String encrypted) {
        requireText(token, "token");
        requireText(expectedComponentAppid, "componentAppid");
        requireText(signature, "signature");
        requireText(timestamp, "timestamp");
        requireText(nonce, "nonce");
        requireText(encrypted, "encrypted");
        byte[] expectedSignature = sha1(token, timestamp, nonce, encrypted);
        byte[] actualSignature;
        try {
            actualSignature = HexFormat.of().parseHex(signature);
        } catch (RuntimeException e) {
            throw invalid();
        }
        if (!MessageDigest.isEqual(expectedSignature, actualSignature)) {
            throw invalid();
        }
        byte[] key = decodeKey(encodingAesKey);
        byte[] ciphertext;
        try {
            ciphertext = Base64.getDecoder().decode(encrypted);
        } catch (IllegalArgumentException e) {
            throw invalid();
        }
        if (ciphertext.length == 0 || ciphertext.length > MAX_ENCRYPTED_BYTES || ciphertext.length % 16 != 0) {
            throw invalid();
        }
        try {
            Cipher cipher = Cipher.getInstance("AES/CBC/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"),
                new IvParameterSpec(Arrays.copyOf(key, 16)));
            return unpack(removePadding(cipher.doFinal(ciphertext)), expectedComponentAppid);
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            throw invalid();
        }
    }

    private String unpack(byte[] plain, String expectedAppid) {
        if (plain.length < RANDOM_PREFIX_BYTES + Integer.BYTES) {
            throw invalid();
        }
        ByteBuffer buffer = ByteBuffer.wrap(plain);
        buffer.position(RANDOM_PREFIX_BYTES);
        int messageLength = buffer.getInt();
        if (messageLength < 0 || messageLength > buffer.remaining()) {
            throw invalid();
        }
        byte[] message = new byte[messageLength];
        buffer.get(message);
        byte[] appid = new byte[buffer.remaining()];
        buffer.get(appid);
        if (!MessageDigest.isEqual(appid, expectedAppid.getBytes(StandardCharsets.UTF_8))) {
            throw invalid();
        }
        return new String(message, StandardCharsets.UTF_8);
    }

    private byte[] removePadding(byte[] value) {
        if (value.length == 0) {
            throw invalid();
        }
        int padding = Byte.toUnsignedInt(value[value.length - 1]);
        if (padding < 1 || padding > 32 || padding > value.length) {
            throw invalid();
        }
        for (int index = value.length - padding; index < value.length; index++) {
            if (Byte.toUnsignedInt(value[index]) != padding) {
                throw invalid();
            }
        }
        return Arrays.copyOf(value, value.length - padding);
    }

    private byte[] decodeKey(String value) {
        requireText(value, "encodingAesKey");
        try {
            byte[] key = Base64.getDecoder().decode(value + "=");
            if (key.length != 32) {
                throw invalid();
            }
            return key;
        } catch (IllegalArgumentException e) {
            throw invalid();
        }
    }

    private byte[] sha1(String... values) {
        try {
            Arrays.sort(values);
            return MessageDigest.getInstance("SHA-1")
                .digest(String.join("", values).getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            throw invalid();
        }
    }

    private void requireText(String value, String field) {
        if (!StringUtils.hasText(value) || value.length() > MAX_ENCRYPTED_BYTES * 2) {
            throw new IllegalArgumentException(field + " is invalid");
        }
    }

    private IllegalArgumentException invalid() {
        return new IllegalArgumentException("Weixin Open Platform callback is invalid");
    }
}
