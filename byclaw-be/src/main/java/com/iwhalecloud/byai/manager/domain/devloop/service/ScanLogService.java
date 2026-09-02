package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.entity.devloop.ScanLog;
import com.iwhalecloud.byai.manager.entity.devloop.ScanRequireItem;
import com.iwhalecloud.byai.manager.mapper.devloop.ScanRequireItemMapper;
import com.iwhalecloud.byai.manager.mapper.devloop.ScanLogMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 扫描日志领域服务 管理扫描执行记录和扫描条目，提供去重判断
 */
@Slf4j
@Service
public class ScanLogService {

    @Autowired
    private ScanLogMapper scanLogMapper;

    @Autowired
    private ScanRequireItemMapper scanRequireItemMapper;

    @Autowired
    private SequenceService sequenceService;

    /** byai_scan_log.error_msg 是 VARCHAR(1000)，openGauss 按字节计长。 */
    private static final int ERROR_MSG_MAX_BYTES = 1000;

    /** byai_scan_log_item.title 是 VARCHAR(500)，同样按字节计长。 */
    private static final int TITLE_MAX_BYTES = 500;

    /**
     * 按 UTF-8 字节截断到列宽。 不能用 StringUtils.abbreviate：它按字符数截，一个中文占 3 字节，
     * 1000 个中文字符会变成 3000 字节，直接撑爆列宽报 value too long。 逐字符累加字节数，保证不在多字节字符中间断开产生乱码。
     */
    private String abbreviateByBytes(String value, int maxBytes) {
        if (StringUtils.isEmpty(value)) {
            return value;
        }
        if (value.getBytes(StandardCharsets.UTF_8).length <= maxBytes) {
            return value;
        }
        StringBuilder truncated = new StringBuilder();
        int usedBytes = 0;
        for (int index = 0; index < value.length(); index++) {
            char current = value.charAt(index);
            // 代理对必须整对处理，单独取一半会变成非法字符。
            int charCount = Character.isHighSurrogate(current) && index + 1 < value.length()
                && Character.isLowSurrogate(value.charAt(index + 1)) ? 2 : 1;
            String unit = value.substring(index, index + charCount);
            int unitBytes = unit.getBytes(StandardCharsets.UTF_8).length;
            if (usedBytes + unitBytes > maxBytes) {
                break;
            }
            truncated.append(unit);
            usedBytes += unitBytes;
            index += charCount - 1;
        }
        return truncated.toString();
    }

    /**
     * 独立事务写一条终态运行记录，并在下发成功时用条目行记住本次建的会话。 聊天型自动化的执行方法带事务，建会话失败会整体回滚；运行记录必须活过那次回滚，
     * 用户才能在自动化页看到失败原因。一次调度是同步下发，没有可观测的中间态，所以直接落终态、不留 running。
     * sessionId 非空时补一行 byai_scan_log_item：定时任务发起的会话本身就是任务，条目行既是「会话即任务」的落点，
     * 也让运行记录能跳回会话（前端按 sessionId 是否有值决定显示入口）。
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordRun(Long sourceId, Long projectId, Long sessionId, String sourceName, String status,
        String errorMsg) {
        ScanLog scanLog = new ScanLog();
        scanLog.setLogId(sequenceService.nextVal());
        scanLog.setSourceId(sourceId);
        scanLog.setProjectId(projectId);
        scanLog.setScanTime(new Date());
        scanLog.setStatus(status);
        // 聊天型自动化没有「发现/创建需求条目」的概念，计数恒 0，列表也不展示这两列。
        scanLog.setFoundCount(0);
        scanLog.setCreatedCount(0);
        scanLog.setErrorMsg(abbreviateByBytes(errorMsg, ERROR_MSG_MAX_BYTES));
        scanLogMapper.insert(scanLog);
        if (sessionId == null) {
            return;
        }
        // title/action/log_id 都是 NOT NULL，所以必须等 scanLog 落库拿到 logId 再写条目行。
        ScanRequireItem item = new ScanRequireItem();
        item.setItemId(sequenceService.nextVal());
        item.setLogId(scanLog.getLogId());
        item.setSourceId(sourceId);
        item.setTitle(abbreviateByBytes(StringUtils.defaultIfBlank(sourceName, "自动化会话"), TITLE_MAX_BYTES));
        item.setAction("created");
        item.setSessionId(sessionId);
        item.setCreateTime(new Date());
        scanRequireItemMapper.insert(item);
    }

    /** 创建一条扫描日志，初始状态为running */
    public ScanLog createLog(Long sourceId, Long projectId) {
        ScanLog scanLog = new ScanLog();
        scanLog.setLogId(sequenceService.nextVal());
        scanLog.setSourceId(sourceId);
        scanLog.setProjectId(projectId);
        scanLog.setScanTime(new Date());
        scanLog.setStatus("running");
        scanLog.setFoundCount(0);
        scanLog.setCreatedCount(0);
        scanLogMapper.insert(scanLog);
        return scanLog;
    }

    /** 标记扫描日志为成功并记录统计 */
    public void completeLog(Long logId, int foundCount, int createdCount) {
        ScanLog scanLog = new ScanLog();
        scanLog.setLogId(logId);
        scanLog.setFoundCount(foundCount);
        scanLog.setCreatedCount(createdCount);
        scanLog.setStatus("success");
        scanLogMapper.updateById(scanLog);
    }

    /** 标记扫描日志为失败并记录错误信息。errorMsg 多为裸异常信息，长度不可控，统一按列宽字节截断。 */
    public void failLog(Long logId, String errorMsg) {
        ScanLog scanLog = new ScanLog();
        scanLog.setLogId(logId);
        scanLog.setStatus("failed");
        scanLog.setErrorMsg(abbreviateByBytes(errorMsg, ERROR_MSG_MAX_BYTES));
        scanLogMapper.updateById(scanLog);
    }

    /** 创建扫描条目记录 */
    public ScanRequireItem createItem(Long logId, Long sourceId, String title, String content, String originId,
        String originUrl, String action) {
        ScanRequireItem item = new ScanRequireItem();
        item.setItemId(sequenceService.nextVal());
        item.setLogId(logId);
        item.setSourceId(sourceId);
        item.setTitle(title);
        item.setContent(content);
        item.setOriginId(originId);
        item.setOriginUrl(originUrl);
        item.setAction(action);
        item.setCreateTime(new Date());
        scanRequireItemMapper.insert(item);
        return item;
    }

    /** 按时间倒序查询指定源的扫描日志 */
    public List<ScanLog> listBySourceId(Long sourceId, int limit) {
        LambdaQueryWrapper<ScanLog> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ScanLog::getSourceId, sourceId).orderByDesc(ScanLog::getScanTime).last("LIMIT " + limit);
        return scanLogMapper.selectList(wrapper);
    }

    /**
     * 分页查询多个扫描源的运行记录，按扫描时间倒序，可按状态收窄。 自动化页的「运行记录」按当前用户的自动化集合反查，所以入口是 sourceId 列表而不是单个源。
     */
    public Page<ScanLog> pageBySourceIds(List<Long> sourceIds, String status, int pageNum, int pageSize) {
        if (sourceIds == null || sourceIds.isEmpty()) {
            return new Page<>(pageNum, pageSize);
        }
        LambdaQueryWrapper<ScanLog> wrapper = new LambdaQueryWrapper<>();
        wrapper.in(ScanLog::getSourceId, sourceIds);
        wrapper.eq(StringUtils.isNotBlank(status), ScanLog::getStatus, status);
        // scan_time 同秒可能有多条，补 log_id 兜底，保证分页顺序稳定不重复不漏行。
        wrapper.orderByDesc(ScanLog::getScanTime).orderByDesc(ScanLog::getLogId);
        return scanLogMapper.selectPage(new Page<>(pageNum, pageSize), wrapper);
    }

    /** 查询某次扫描的所有条目 */
    public List<ScanRequireItem> listItemsByLogId(Long logId) {
        LambdaQueryWrapper<ScanRequireItem> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ScanRequireItem::getLogId, logId).orderByAsc(ScanRequireItem::getCreateTime);
        return scanRequireItemMapper.selectList(wrapper);
    }

    /**
     * 批量取多条运行记录各自关联的会话ID，供运行记录列表一次查全部。 逐条查会话是 N+1，一页 20 行就是 20 条 SQL，这里合并成一次 IN 查询。
     * 一次调度最多写一行条目，重复行按先到先得。
     */
    public Map<Long, Long> mapSessionIdByLogIds(List<Long> logIds) {
        if (logIds == null || logIds.isEmpty()) {
            return new HashMap<>();
        }
        LambdaQueryWrapper<ScanRequireItem> wrapper = new LambdaQueryWrapper<>();
        wrapper.in(ScanRequireItem::getLogId, logIds).isNotNull(ScanRequireItem::getSessionId);
        Map<Long, Long> sessionIdByLogId = new HashMap<>();
        for (ScanRequireItem item : scanRequireItemMapper.selectList(wrapper)) {
            sessionIdByLogId.putIfAbsent(item.getLogId(), item.getSessionId());
        }
        return sessionIdByLogId;
    }

    /** 查询某扫描源下所有已收集(created)的需求条目，按时间倒序，供需求列表直查 */
    public List<ScanRequireItem> listCreatedItemsBySource(Long sourceId) {
        LambdaQueryWrapper<ScanRequireItem> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ScanRequireItem::getSourceId, sourceId).eq(ScanRequireItem::getAction, "created")
            .orderByDesc(ScanRequireItem::getCreateTime);
        return scanRequireItemMapper.selectList(wrapper);
    }

    /**
     * 批量查询多个扫描源下已收集(created)的需求条目，按时间倒序。 供项目需求列表一次查全部源，避免前端逐源循环请求(N+1)与内存排序。
     */
    public List<ScanRequireItem> listCreatedItemsBySources(List<Long> sourceIds) {
        return listCreatedItemsBySources(sourceIds, null);
    }

    /** 批量查询项目扫描源的已收集需求，并仅按需求名称进行模糊匹配。 */
    public List<ScanRequireItem> listCreatedItemsBySources(List<Long> sourceIds, String title) {
        if (sourceIds == null || sourceIds.isEmpty()) {
            return new java.util.ArrayList<>();
        }
        LambdaQueryWrapper<ScanRequireItem> wrapper = new LambdaQueryWrapper<>();
        wrapper.in(ScanRequireItem::getSourceId, sourceIds).eq(ScanRequireItem::getAction, "created");
        String normalizedTitle = StringUtils.trimToNull(title);
        if (normalizedTitle != null) {
            // PostgreSQL 的 LIKE 区分大小写，需求标题查询统一小写后保持搜索口径一致。
            wrapper.apply("LOWER(title) LIKE {0}", "%" + normalizedTitle.toLowerCase(Locale.ROOT) + "%");
        }
        wrapper.orderByDesc(ScanRequireItem::getCreateTime);
        return scanRequireItemMapper.selectList(wrapper);
    }

    /** 判断同一源下是否已存在相同originId的已创建条目 */
    public boolean isDuplicate(Long sourceId, String originId) {
        LambdaQueryWrapper<ScanRequireItem> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ScanRequireItem::getSourceId, sourceId).eq(ScanRequireItem::getOriginId, originId).eq(ScanRequireItem::getAction,
            "created");
        return scanRequireItemMapper.selectCount(wrapper) > 0;
    }

    /**
     * 删除会话关联的扫描
     *
     * @param sessionId 会话信息
     */
    public void deleteItemBySessionId(Long sessionId) {

        if (sessionId == null) {
            return;
        }

        LambdaQueryWrapper<ScanRequireItem> deleteWrapper = new LambdaQueryWrapper<>();
        deleteWrapper.eq(ScanRequireItem::getSessionId, sessionId);
        scanRequireItemMapper.delete(deleteWrapper);
    }

}
