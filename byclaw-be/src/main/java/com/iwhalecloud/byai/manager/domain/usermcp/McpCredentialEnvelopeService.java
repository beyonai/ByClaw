package com.iwhalecloud.byai.manager.domain.usermcp;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/** AES-GCM envelope for MCP credentials. The key must be supplied by deployment secret management. */
@Service
public class McpCredentialEnvelopeService {

    private static final String VERSION = "v1";
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;

    private final byte[] key;
    private final SecureRandom secureRandom = new SecureRandom();

    public McpCredentialEnvelopeService(@Value("${byai.mcp.credential-key:}") String encodedKey) {
        this.key = decodeKey(encodedKey);
    }

    public String seal(String plaintext, String context) {
        if (!StringUtils.hasText(plaintext)) {
            return null;
        }
        requireKey();
        byte[] iv = new byte[IV_BYTES];
        secureRandom.nextBytes(iv);
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(TAG_BITS, iv));
            cipher.updateAAD(context.getBytes(StandardCharsets.UTF_8));
            byte[] ciphertext = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            Base64.Encoder encoder = Base64.getUrlEncoder().withoutPadding();
            return VERSION + "." + encoder.encodeToString(iv) + "." + encoder.encodeToString(ciphertext);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("Unable to encrypt MCP credential", e);
        }
    }

    public String open(String envelope, String context) {
        if (!StringUtils.hasText(envelope)) {
            return null;
        }
        requireKey();
        String[] parts = envelope.split("\\.");
        if (parts.length != 3 || !VERSION.equals(parts[0])) {
            throw new IllegalArgumentException("Unsupported MCP credential envelope");
        }
        try {
            Base64.Decoder decoder = Base64.getUrlDecoder();
            byte[] iv = decoder.decode(parts[1]);
            if (iv.length != IV_BYTES) {
                throw new IllegalArgumentException("Invalid MCP credential envelope");
            }
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(TAG_BITS, iv));
            cipher.updateAAD(context.getBytes(StandardCharsets.UTF_8));
            return new String(cipher.doFinal(decoder.decode(parts[2])), StandardCharsets.UTF_8);
        } catch (GeneralSecurityException | IllegalArgumentException e) {
            throw new SecurityException("MCP credential envelope verification failed", e);
        }
    }

    private byte[] decodeKey(String encodedKey) {
        if (!StringUtils.hasText(encodedKey)) {
            return null;
        }
        try {
            byte[] decoded = Base64.getDecoder().decode(encodedKey);
            if (decoded.length != 32) {
                throw new IllegalArgumentException("byai.mcp.credential-key must be a Base64 encoded 256-bit key");
            }
            return decoded;
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("Invalid byai.mcp.credential-key", e);
        }
    }

    private void requireKey() {
        if (key == null) {
            throw new IllegalStateException("MCP credential encryption key is not configured");
        }
    }
}
