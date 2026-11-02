package com.iwhalecloud.byai.manager.application.service.aimodel;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.manager.application.service.aimodel.ModelHealthApplicationService.Report;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import java.util.function.UnaryOperator;
import org.springframework.stereotype.Component;

/** Model-health business state. All Redis access uses the existing shared RedisUtil. */
@Component
public class ModelHealthCache {
    static final long DAY = Duration.ofDays(1).toMillis();
    private static final long RETENTION_SECONDS = Duration.ofDays(30).toSeconds();
    private final ObjectMapper json = new ObjectMapper();

    String key(String scope) {
        return key(scope, CurrentUserHolder.getCurrentUserId());
    }

    private String key(String scope, Long owner) {
        // Public model definitions are global; personal definitions belong to their creator.
        return "byclaw:model-health:v4:" + scope + ("PERSONAL".equals(scope) ? ":" + owner : "");
    }

    Report read(String scope) { return readKey(key(scope)); }

    private Report readKey(String key) { return decode(RedisUtil.hmGet(key, "report"), Report.class); }

    long begin(String scope, String modelId) {
        return locked(key(scope), () -> beginKey(key(scope), modelId));
    }

    private long beginKey(String key, String modelId) {
        String old = RedisUtil.hmGet(key, "revision");
        long revision = old == null ? 1 : Long.parseLong(old) + 1;
        String value = String.valueOf(revision);
        RedisUtil.hmPutAll(key, modelId == null ? Map.of("revision", value)
            : Map.of("revision", value, field(modelId), value));
        RedisUtil.expire(key, RETENTION_SECONDS, TimeUnit.SECONDS);
        return revision;
    }

    private String field(String modelId) { return modelId == null ? "revision" : "pending:" + modelId; }

    boolean acquireLogin(String scope, String token) {
        return Boolean.TRUE.equals(RedisUtil.lock(key(scope) + ":login", token, 600));
    }

    void releaseLogin(String scope, String token) { RedisUtil.releaseLock(key(scope) + ":login", token); }

    Report update(String scope, String modelId, Long revision, UnaryOperator<Report> change) {
        String key = key(scope);
        return locked(key, () -> {
            if (revision != null && !Objects.equals(RedisUtil.hmGet(key, field(modelId)), revision.toString())) return null;
            Report next = change.apply(readKey(key));
            RedisUtil.hmPut(key, "report", encode(next));
            RedisUtil.expire(key, RETENTION_SECONDS, TimeUnit.SECONDS);
            return next;
        });
    }

    void evict(String scope, Long owner, String id) {
        String key = key(scope, owner);
        locked(key, () -> {
            beginKey(key, id);
            Report previous = readKey(key);
            if (previous == null) return null;
            List<ModelHealthApplicationService.Item> items = previous.models().stream()
                .filter(item -> !id.equals(item.modelId())).toList();
            Report next = new Report(scope, previous.checkedAt(), items.stream().noneMatch(item -> "FAILED".equals(item.status())),
                items, previous.loginCheckedAt(), previous.presented(), previous.dismissed(),
                id.equals(previous.focusModelId()) ? null : previous.focusModelId());
            RedisUtil.hmPut(key, "report", encode(next));
            return null;
        });
    }

    void invalidatePending(String scope, Long owner, String id) {
        String key = key(scope, owner);
        locked(key, () -> beginKey(key, id));
    }

    record Notice(long checkedAt, boolean presented, boolean dismissed) { }

    Report withNotice(Report report, boolean login) {
        if (report == null) return null;
        Notice notice = decode(RedisUtil.hmGet(key(report.scope()), noticeField()), Notice.class);
        boolean matching = notice != null && notice.checkedAt() == report.checkedAt();
        return new Report(report.scope(), report.checkedAt(), report.healthy(), report.models(), report.loginCheckedAt(),
            matching ? notice.presented() : !login, matching ? notice.dismissed() : !login, report.focusModelId());
    }

    void notice(String scope, long checkedAt, boolean presented, boolean dismissed) {
        String key = key(scope);
        locked(key, () -> {
            Report current = readKey(key);
            if (current != null && current.checkedAt() == checkedAt) {
                RedisUtil.hmPut(key, noticeField(), encode(new Notice(checkedAt, presented, dismissed)));
            }
            return null;
        });
    }

    private String noticeField() { return "notice:" + CurrentUserHolder.getCurrentUserId(); }

    /** Only short read/merge/write sections hold this lock; inference always runs outside it. */
    private <T> T locked(String key, Supplier<T> action) {
        String lockKey = key + ":update";
        String token = UUID.randomUUID().toString();
        boolean acquired = false;
        try {
            for (int attempt = 0; attempt < 50; attempt++) {
                acquired = Boolean.TRUE.equals(RedisUtil.lock(lockKey, token, 30));
                if (acquired) return action.get();
                Thread.sleep(20);
            }
            throw new IllegalStateException("Model health cache busy");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Model health cache interrupted", e);
        } finally {
            if (acquired) RedisUtil.releaseLock(lockKey, token);
        }
    }

    private String encode(Object value) {
        try { return json.writeValueAsString(value); }
        catch (Exception e) { throw new IllegalStateException("Invalid model health cache", e); }
    }

    private <T> T decode(String raw, Class<T> type) {
        if (raw == null) return null;
        try { return json.readValue(raw, type); }
        catch (Exception e) { throw new IllegalStateException("Invalid model health cache", e); }
    }
}
