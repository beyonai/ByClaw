package com.iwhalecloud.byai.manager.domain.tenant;

import com.iwhalecloud.byai.manager.mapper.source.SourceSystemMapper;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.Base64;
import java.util.HexFormat;
import java.util.function.Supplier;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/** Stable purpose-separated identities derived from the existing deployment application identity. */
@Component
public final class TenantRuntimeIdentity {
    private final Supplier<String> source;
    private volatile String seed;

    @Autowired
    public TenantRuntimeIdentity(SourceSystemMapper mapper) {
        this.source = () -> {
            var values = mapper.selectPlatformIdentitySecrets();
            if (values.size() != 1) throw new IllegalStateException("Expected one platform application identity");
            return values.get(0);
        };
    }

    public TenantRuntimeIdentity(String seed) {
        this.source = () -> seed;
    }

    public String masterKeyHex() {
        return HexFormat.of().formatHex(derive("byclaw:tenant:credential-master:v1"));
    }

    public String internalToken() {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(derive("byclaw:tenant:internal-auth:v1"));
    }

    private byte[] derive(String purpose) {
        String current = seed;
        if (current == null) {
            synchronized (this) {
                if (seed == null) {
                    String value = source.get();
                    if (value == null || value.getBytes(StandardCharsets.UTF_8).length < 32)
                        throw new IllegalStateException("Platform application identity is missing or too short");
                    seed = value;
                }
                current = seed;
            }
        }
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(current.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return mac.doFinal(purpose.getBytes(StandardCharsets.UTF_8));
        } catch (GeneralSecurityException failure) {
            throw new IllegalStateException("Unable to derive tenant runtime identity", failure);
        }
    }
}
