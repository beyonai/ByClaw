package com.iwhalecloud.byai.manager.application.runner;

import com.iwhalecloud.byai.manager.mapper.resource.ResourceJsonCacheMapper;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceJsonCacheService;
import java.util.List;
import java.util.Objects;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

/** Backfills resources that predate Redis mirroring without republishing files or modifying the database. */
@Component
@RequiredArgsConstructor
public class InitResourceJsonCacheRunner implements ApplicationRunner {
    private static final Logger LOG = LoggerFactory.getLogger(InitResourceJsonCacheRunner.class);
    private final ResourceJsonCacheMapper resources;
    private final ResourceJsonCacheService cache;
    @Value("${init.Redis.resource.json.runner.enabled:true}")
    private boolean enabled = true;

    @Override
    public void run(ApplicationArguments args) {
        if (!enabled) return;
        long cursor = 0;
        try {
            while (true) {
                List<ResourceJsonCacheMapper.Entry> page = resources.page(cursor, 200);
                if (page.isEmpty()) break;
                for (var entry : page) {
                    cursor = entry.getResourceId();
                    try {
                        if (Objects.equals(entry.getResourceStatus(), 2)) {
                            cache.putAfterCommit(entry.getResourceBizType(), entry.getResourceId(), entry.getTargetContent());
                        } else {
                            cache.removeAfterCommit(entry.getResourceBizType(), entry.getResourceId());
                        }
                    } catch (RuntimeException e) {
                        LOG.warn("Cannot backfill resource JSON, resourceId={}", entry.getResourceId(), e);
                    }
                }
            }
        } catch (RuntimeException e) {
            LOG.error("Resource JSON startup backfill failed, afterId={}", cursor, e);
        }
    }
}
