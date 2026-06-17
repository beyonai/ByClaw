package com.iwhalecloud.byai.gateway.sandbox.service.cronprewarm;

import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.common.util.RedisUtil;

@Service
public class SandboxCronPrewarmCursorStore {

    public Long getCursor(String key) {
        String value = RedisUtil.getString(key);
        if (StringUtils.isBlank(value)) {
            return 0L;
        }
        try {
            return Long.valueOf(value);
        }
        catch (NumberFormatException e) {
            return 0L;
        }
    }

    public void saveCursor(String key, Long userId) {
        if (StringUtils.isBlank(key) || userId == null) {
            return;
        }
        RedisUtil.setString(key, String.valueOf(userId));
    }
}
