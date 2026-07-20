package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.devloop.ScanLog;
import com.iwhalecloud.byai.manager.entity.devloop.ScanLogItem;
import com.iwhalecloud.byai.manager.mapper.devloop.ScanLogItemMapper;
import com.iwhalecloud.byai.manager.mapper.devloop.ScanLogMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Date;
import java.util.List;

/**
 * 扫描日志领域服务
 * 管理扫描执行记录和扫描条目，提供去重判断
 */
@Slf4j
@Service
public class ScanLogService {

    @Autowired
    private ScanLogMapper scanLogMapper;

    @Autowired
    private ScanLogItemMapper scanLogItemMapper;

    @Autowired
    private SequenceService sequenceService;

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

    /** 标记扫描日志为失败并记录错误信息 */
    public void failLog(Long logId, String errorMsg) {
        ScanLog scanLog = new ScanLog();
        scanLog.setLogId(logId);
        scanLog.setStatus("failed");
        scanLog.setErrorMsg(errorMsg);
        scanLogMapper.updateById(scanLog);
    }

    /** 创建扫描条目记录 */
    public ScanLogItem createItem(Long logId, Long sourceId, String title,
                                  String content, String originId,
                                  String originUrl, String action) {
        ScanLogItem item = new ScanLogItem();
        item.setItemId(sequenceService.nextVal());
        item.setLogId(logId);
        item.setSourceId(sourceId);
        item.setTitle(title);
        item.setContent(content);
        item.setOriginId(originId);
        item.setOriginUrl(originUrl);
        item.setAction(action);
        item.setCreateTime(new Date());
        scanLogItemMapper.insert(item);
        return item;
    }

    /** 按时间倒序查询指定源的扫描日志 */
    public List<ScanLog> listBySourceId(Long sourceId, int limit) {
        LambdaQueryWrapper<ScanLog> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ScanLog::getSourceId, sourceId)
               .orderByDesc(ScanLog::getScanTime)
               .last("LIMIT " + limit);
        return scanLogMapper.selectList(wrapper);
    }

    /** 查询某次扫描的所有条目 */
    public List<ScanLogItem> listItemsByLogId(Long logId) {
        LambdaQueryWrapper<ScanLogItem> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ScanLogItem::getLogId, logId)
               .orderByAsc(ScanLogItem::getCreateTime);
        return scanLogItemMapper.selectList(wrapper);
    }

    /** 查询某扫描源下所有已收集(created)的需求条目，按时间倒序，供需求列表直查 */
    public List<ScanLogItem> listCreatedItemsBySource(Long sourceId) {
        LambdaQueryWrapper<ScanLogItem> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ScanLogItem::getSourceId, sourceId)
               .eq(ScanLogItem::getAction, "created")
               .orderByDesc(ScanLogItem::getCreateTime);
        return scanLogItemMapper.selectList(wrapper);
    }

    /** 判断同一源下是否已存在相同originId的已创建条目 */
    public boolean isDuplicate(Long sourceId, String originId) {
        LambdaQueryWrapper<ScanLogItem> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ScanLogItem::getSourceId, sourceId)
               .eq(ScanLogItem::getOriginId, originId)
               .eq(ScanLogItem::getAction, "created");
        return scanLogItemMapper.selectCount(wrapper) > 0;
    }
}
