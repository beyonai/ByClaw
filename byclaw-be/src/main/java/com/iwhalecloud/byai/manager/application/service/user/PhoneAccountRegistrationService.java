package com.iwhalecloud.byai.manager.application.service.user;

import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.users.Users;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 串行化已接入的手机号注册入口，不改变现有数据库结构。 */
@Service
public class PhoneAccountRegistrationService {

    private final JdbcTemplate jdbcTemplate;
    private final UserService userService;
    private final UserApplicationService userApplicationService;

    public PhoneAccountRegistrationService(JdbcTemplate jdbcTemplate, UserService userService,
        UserApplicationService userApplicationService) {
        this.jdbcTemplate = jdbcTemplate;
        this.userService = userService;
        this.userApplicationService = userApplicationService;
    }

    @Transactional
    public Users resolveOrRegister(String phone) {
        return resolve(phone, true);
    }

    @Transactional
    public Users registerNew(String phone) {
        return resolve(phone, false);
    }

    private Users resolve(String phone, boolean allowExisting) {
        String normalized = phone == null ? "" : phone.trim();
        if (normalized.isEmpty()) {
            throw new BadCredentialsException("手机号无效");
        }
        // 事务锁覆盖持锁后的查询和插入；多实例间可串行化这两条受控注册路径。
        jdbcTemplate.queryForObject("SELECT pg_advisory_xact_lock(?)", Object.class, lockKey(normalized));
        List<Users> matches = userService.findAllByUserPhone(normalized);
        if (matches.size() > 1) {
            throw new BadCredentialsException("手机号关联多个账号");
        }
        if (matches.size() == 1) {
            if (!allowExisting) {
                throw new BadCredentialsException("手机号已注册");
            }
            return matches.get(0);
        }
        return userApplicationService.registerByPhone(normalized);
    }

    private long lockKey(String phone) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest(phone.getBytes(StandardCharsets.UTF_8));
            return ByteBuffer.wrap(digest).getLong();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
