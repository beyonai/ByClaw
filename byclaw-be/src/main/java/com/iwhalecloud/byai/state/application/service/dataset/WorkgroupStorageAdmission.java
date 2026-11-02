package com.iwhalecloud.byai.state.application.service.dataset;

import com.fasterxml.jackson.databind.JsonNode;
import com.iwhalecloud.byai.common.feign.client.FeignPythonBuildService;
import com.iwhalecloud.byai.common.feign.client.KnowledgeHttpFailure;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbListDir;
import com.iwhalecloud.byai.common.feign.response.PythonBuildResponse;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.Data;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.DirOrFile;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KbImportResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KbFileUpdateResult;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.lock.TransactionalRedisLockService;
import com.iwhalecloud.byai.common.quota.HacuStoragePolicyReader;
import com.iwhalecloud.byai.manager.domain.operations.EnterpriseStorageService;
import com.iwhalecloud.byai.manager.mapper.operations.EnterpriseStorageMapper;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.locks.Lock;
import java.util.function.Supplier;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

/** 仅约束 HACU 套餐企业工作组云盘；分布式锁覆盖统计、容量预留及同步文件写入。 @author Codex @since 2026-11-02 */
@Component
public class WorkgroupStorageAdmission {
    private static final Logger LOG = LoggerFactory.getLogger(WorkgroupStorageAdmission.class);
    private final EnterpriseStorageMapper resources;
    private final HacuStoragePolicyReader policies;
    private final EnterpriseStorageService statistics;
    private final FeignPythonBuildService knowledge;
    private final TransactionalRedisLockService locks;
    private final StringRedisTemplate redis;

    public WorkgroupStorageAdmission(EnterpriseStorageMapper resources, HacuStoragePolicyReader policies,
            EnterpriseStorageService statistics, FeignPythonBuildService knowledge,
            TransactionalRedisLockService locks, StringRedisTemplate redis) {
        this.resources = resources;
        this.policies = policies;
        this.statistics = statistics;
        this.knowledge = knowledge;
        this.locks = locks;
        this.redis = redis;
    }

    /** 调用方先做资源权限校验；普通资源和无 HACU 策略的工作组不查询 QA 或获取配额锁。 */
    public <T> PythonBuildResponse<T> write(long resourceId, String knCode, String path, MultipartFile file,
            Boolean extractZip, boolean replace, Supplier<PythonBuildResponse<T>> operation) {
        List<Long> owners = resources.selectCloudEnterprises(resourceId);
        if (owners.isEmpty()) {
            return operation.get();
        }
        if (owners.size() != 1 || owners.get(0) <= 0) {
            throw HacuStoragePolicyReader.unavailable();
        }
        long enterpriseId = owners.get(0);
        boolean managed = resources.commerciallyManaged(enterpriseId);
        Long limit = policies.read(enterpriseId, managed);
        if (limit == null) {
            return operation.get();
        }
        String lockKey = "quota-write-guard:HACU_STORAGE:" + enterpriseId;
        Lock lock = locks.obtain(lockKey);
        try {
            // 等待其他工作组写完后重新读取额度，升级、降级无需重新登录。
            limit = policies.read(enterpriseId, managed);
            if (limit == null) {
                return operation.get();
            }
            String pendingKey = policies.pendingKey(enterpriseId);
            if (Boolean.TRUE.equals(redis.hasKey(pendingKey))) {
                throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, I18nUtil.get("hacu.storage.quota.pending"));
            }
            long incoming = incomingBytes(file, extractZip, replace, limit);
            long previous = replace ? existingBytes(resourceId, knCode, path) : 0;
            long growth = Math.max(0, incoming - previous);
            if (growth > 0) {
                BigDecimal upper = usedBytesUpperBound(readUsage(enterpriseId));
                if (upper.add(BigDecimal.valueOf(growth)).compareTo(BigDecimal.valueOf(limit)) > 0) {
                    throw exceeded();
                }
            }
            locks.validate(lockKey);
            // 发送前持久记录本次占用；进程退出/超时不能被误认为未写入而自动释放。
            String reservation = UUID.randomUUID() + ":" + growth;
            if (!Boolean.TRUE.equals(redis.opsForValue().setIfAbsent(pendingKey, reservation))) {
                throw HacuStoragePolicyReader.unavailable();
            }
            PythonBuildResponse<T> result;
            try {
                result = operation.get();
            } catch (KnowledgeHttpFailure rejected) {
                LOG.error("Knowledge service rejected cloud write, enterpriseId={}", enterpriseId, rejected);
                if (rejected.isDefiniteRejection()) {
                    release(pendingKey, reservation);
                }
                throw rejected;
            }
            locks.validate(lockKey);
            if (!completed(result)) {
                throw HacuStoragePolicyReader.unavailable();
            }
            // QA 同步完成后，后续写入重新查询真实统计；不维护竞争性的长期用量账本。
            release(pendingKey, reservation);
            return result;
        } catch (RuntimeException failure) {
            LOG.error("Workgroup storage write rejected or unresolved, enterpriseId={}", enterpriseId, failure);
            throw failure;
        } finally {
            lock.unlock();
        }
    }

    /** 统计不可用不能填零放行，也不能把服务桥内部异常作为页面错误泄漏。 */
    private JsonNode readUsage(long enterpriseId) {
        try {
            return statistics.usage(enterpriseId);
        } catch (RuntimeException failure) {
            LOG.error("Cannot verify enterprise cloud usage, enterpriseId={}", enterpriseId, failure);
            throw HacuStoragePolicyReader.unavailable();
        }
    }

    /** QA 按库舍入会少报至多约 5 字节，容量判断取保守上界，展示仍使用原始 KB。 */
    private BigDecimal usedBytesUpperBound(JsonNode usage) {
        BigDecimal total = BigDecimal.ZERO;
        for (JsonNode cloud : usage.path("groups")) {
            BigDecimal bytes = new BigDecimal(cloud.path("usedKb").asText()).multiply(BigDecimal.valueOf(1024));
            if (cloud.path("fileCount").asLong() > 0) {
                bytes = bytes.add(new BigDecimal("5.12")).setScale(0, RoundingMode.FLOOR);
            }
            total = total.add(bytes);
        }
        return total;
    }

    /** ZIP 默认解压，读取实际展开字节而非压缩包大小；不把目录项计入容量。 */
    private long incomingBytes(MultipartFile file, Boolean extractZip, boolean replace, long limit) {
        if (replace || Boolean.FALSE.equals(extractZip) || file.getOriginalFilename() == null
                || !file.getOriginalFilename().toLowerCase(Locale.ROOT).endsWith(".zip")) {
            if (file.getSize() < 0) {
                throw HacuStoragePolicyReader.unavailable();
            }
            return file.getSize();
        }
        Path archive = null;
        try {
            archive = Files.createTempFile("hacu-storage-", ".zip");
            try (InputStream input = file.getInputStream()) {
                Files.copy(input, archive, StandardCopyOption.REPLACE_EXISTING);
            }
            // 用中央目录遍历，兼容带前置数据的 ZIP；名称仅用于识别目录，不依赖本地编码。
            try (ZipFile zip = new ZipFile(archive.toFile(), StandardCharsets.ISO_8859_1)) {
                long size = 0;
                byte[] buffer = new byte[8192];
                var entries = zip.entries();
                while (entries.hasMoreElements()) {
                    ZipEntry entry = entries.nextElement();
                    if (entry.isDirectory()) {
                        continue;
                    }
                    try (InputStream content = zip.getInputStream(entry)) {
                        int read;
                        while ((read = content.read(buffer)) != -1) {
                            if (read > limit - size) {
                                throw exceeded();
                            }
                            size += read;
                        }
                    }
                }
                // 不低于原始包大小，避免 QA 按普通文件保留压缩包时少计。
                return Math.max(size, file.getSize());
            }
        } catch (IOException failure) {
            LOG.error("Cannot determine expanded cloud upload size", failure);
            throw HacuStoragePolicyReader.unavailable();
        } finally {
            if (archive != null) {
                try {
                    Files.deleteIfExists(archive);
                } catch (IOException failure) {
                    LOG.error("Cannot remove temporary storage sizing archive", failure);
                }
            }
        }
    }

    /** 覆盖按旧文件实际字节扣除；目录结果缺失或不完整时不猜测旧文件大小。 */
    private long existingBytes(long resourceId, String knCode, String path) {
        int slash = path.lastIndexOf('/');
        String parent = slash <= 0 ? "/" : path.substring(0, slash);
        String name = path.substring(slash + 1);
        KbListDir request = new KbListDir();
        request.setKnCode(knCode);
        request.setDirectoryPath(parent);
        PythonBuildResponse<Data> response = knowledge.listDir(request, resourceId);
        if (response == null || !"0".equals(response.getResultCode()) || response.getResultObject() == null
                || response.getResultObject().getData() == null) {
            throw HacuStoragePolicyReader.unavailable();
        }
        List<DirOrFile> entries = response.getResultObject().getData().stream()
            .filter(item -> item != null && "file".equalsIgnoreCase(item.getType()))
            .filter(item -> name.equals(item.getName()) || path.equals(item.getName())).toList();
        if (entries.size() != 1 || entries.get(0).getSize() == null || entries.get(0).getSize() < 0) {
            throw HacuStoragePolicyReader.unavailable();
        }
        return entries.get(0).getSize();
    }

    /** 明确返回逐项最终状态才释放预留，未知结果保留并等待核对。 */
    private boolean completed(PythonBuildResponse<?> response) {
        if (response != null && "-1".equals(response.getResultCode())) {
            return true;
        }
        if (response == null || !"0".equals(response.getResultCode())) {
            return false;
        }
        if (response.getResultObject() instanceof KbImportResult imported) {
            return imported.getData() != null && !imported.getData().isEmpty()
                && imported.getData().stream().allMatch(item -> item != null && item.getSuccess() != null);
        }
        if (response.getResultObject() instanceof KbFileUpdateResult updated) {
            return updated.getData() != null && !updated.getData().isEmpty()
                && updated.getData().stream().allMatch(item -> item != null && item.getSuccess() != null);
        }
        return false;
    }

    /** 只释放自己的占用标记；锁失效或人工核对后不得删除另一笔写入的标记。 */
    private void release(String pendingKey, String reservation) {
        DefaultRedisScript<Long> release = new DefaultRedisScript<>(
            "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0", Long.class);
        Long released = redis.execute(release, List.of(pendingKey), reservation);
        if (!Long.valueOf(1L).equals(released)) {
            throw HacuStoragePolicyReader.unavailable();
        }
    }

    private ResponseStatusException exceeded() {
        return new ResponseStatusException(HttpStatus.CONFLICT, I18nUtil.get("hacu.storage.quota.exceeded"));
    }
}
