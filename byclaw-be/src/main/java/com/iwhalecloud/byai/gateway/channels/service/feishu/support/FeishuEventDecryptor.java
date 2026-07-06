package com.iwhalecloud.byai.gateway.channels.service.feishu.support;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Base64;

import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;

import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

/**
 * 飞书事件回调解密器。
 *
 * <p>飞书开放平台开启“加密策略”后，请求体不再直接发送 challenge 或 event，
 * 而是发送形如 {@code {"encrypt":"..."}} 的密文。按照飞书事件订阅规则：
 * 用 Encrypt Key 的 SHA-256 结果作为 AES 密钥，再对 encrypt 字段做 AES/CBC/PKCS5Padding
 * 解密后即可得到原始事件 JSON。</p>
 */
@Component
public class FeishuEventDecryptor {

    private static final String DIGEST_ALGORITHM = "SHA-256";
    private static final String AES_ALGORITHM = "AES";
    private static final String AES_TRANSFORMATION = "AES/CBC/PKCS5Padding";
    private static final int AES_BLOCK_SIZE = 16;

    public String decrypt(String encryptedPayload, String encryptKey) {
        if (!StringUtils.hasText(encryptedPayload)) {
            throw new IllegalArgumentException("Feishu encrypted payload is empty");
        }
        if (!StringUtils.hasText(encryptKey)) {
            throw new IllegalArgumentException("Feishu encryptKey is empty");
        }

        try {
            byte[] aesKey = sha256(encryptKey);
            byte[] encryptedBytes = Base64.getDecoder().decode(encryptedPayload);
            return decryptWithCompatibleIv(encryptedBytes, aesKey);
        } catch (Exception e) {
            throw new IllegalStateException("Decrypt Feishu encrypted event failed", e);
        }
    }

    /**
     * 飞书历史示例和平台实际回调里都可能出现 CBC IV：
     * 1. 取 SHA-256 后 AES Key 的前 16 字节作为 IV；
     * 2. 把随机 IV 拼在密文字节前 16 位，真实密文从第 17 位开始。
     *
     * <p>这里两种方式都试，并且只返回看起来是 JSON 对象的明文，避免错误 IV
     * 恰好通过 padding 校验后把乱码继续交给 Controller 解析。</p>
     */
    private String decryptWithCompatibleIv(byte[] encryptedBytes, byte[] aesKey) throws Exception {
        Exception lastError = null;

        try {
            String plainText = decryptWithIv(encryptedBytes, aesKey, Arrays.copyOf(aesKey, AES_BLOCK_SIZE));
            if (looksLikeJsonObject(plainText)) {
                return plainText;
            }
        } catch (Exception e) {
            lastError = e;
        }

        if (encryptedBytes.length > AES_BLOCK_SIZE) {
            try {
                byte[] iv = Arrays.copyOfRange(encryptedBytes, 0, AES_BLOCK_SIZE);
                byte[] actualCipherBytes = Arrays.copyOfRange(encryptedBytes, AES_BLOCK_SIZE, encryptedBytes.length);
                String plainText = decryptWithIv(actualCipherBytes, aesKey, iv);
                if (looksLikeJsonObject(plainText)) {
                    return plainText;
                }
            } catch (Exception e) {
                lastError = e;
            }
        }

        throw new IllegalStateException("Feishu decrypted text is not valid JSON object", lastError);
    }

    private String decryptWithIv(byte[] cipherBytes, byte[] aesKey, byte[] iv) throws Exception {
        Cipher cipher = Cipher.getInstance(AES_TRANSFORMATION);
        cipher.init(
                Cipher.DECRYPT_MODE,
                new SecretKeySpec(aesKey, AES_ALGORITHM),
                new IvParameterSpec(iv)
        );
        byte[] plainBytes = cipher.doFinal(cipherBytes);
        return new String(plainBytes, StandardCharsets.UTF_8);
    }

    private boolean looksLikeJsonObject(String plainText) {
        if (!StringUtils.hasText(plainText)) {
            return false;
        }
        String trimmed = plainText.trim();
        return trimmed.startsWith("{") && trimmed.endsWith("}");
    }

    private byte[] sha256(String value) throws Exception {
        MessageDigest digest = MessageDigest.getInstance(DIGEST_ALGORITHM);
        return digest.digest(value.getBytes(StandardCharsets.UTF_8));
    }
}
