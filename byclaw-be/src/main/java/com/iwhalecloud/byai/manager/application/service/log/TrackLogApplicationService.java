package com.iwhalecloud.byai.manager.application.service.log;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.util.IpUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.state.domain.log.dto.BatchTrackLogDto;
import com.iwhalecloud.byai.manager.entity.log.TrackLog;
import com.iwhalecloud.byai.state.domain.log.service.TrackLogService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.List;

/**
 * @author he.duming
 * @date 2025-12-25 15:45:28
 * @description TODO
 */
@Service
public class TrackLogApplicationService {

    private final Logger logger = LoggerFactory.getLogger(TrackLogApplicationService.class);

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private TrackLogService trackLogService;

    /**
     * 保存埋点日志
     *
     * @param trackLog 埋点日志
     */
    public void saveTrackLog(HttpServletRequest request, TrackLog trackLog) {
        // 生成主键ID
        trackLog.setTraceId(sequenceService.nextSnowId());
        trackLog.setCreateTime(new Date());
        trackLog.setUserId(CurrentUserHolder.getCurrentUserId());
        trackLog.setIp(IpUtil.getIpAddress(request));
        trackLog.setBrowserInfo(request.getHeader("User-Agent"));
        trackLog.setOsType(IpUtil.getOsType(request));
        trackLogService.saveTrackLog(trackLog);
    }

    /**
     * 批量保存埋点日志
     *
     * @param request 请求对象
     * @param batchTrackLogDto 批量保存入参
     */
    public void batchSaveTrackLog(HttpServletRequest request, BatchTrackLogDto batchTrackLogDto) {
        List<TrackLog> trackLogs = batchTrackLogDto.getTrackLogs();
        for (int i = 0; trackLogs != null && i < trackLogs.size(); i++) {
            TrackLog trackLog = trackLogs.get(i);
            this.saveTrackLog(request, trackLog);
        }
    }

    /**
     * Get方式保存日志
     *
     * @param request 请求入参
     * @param enCodeTrackLogs 批量保存URLEnCode编码数组入参
     */
    public void saveTrackLogByURLEnCode(HttpServletRequest request, String enCodeTrackLogs) {

        if (StringUtil.isEmpty(enCodeTrackLogs)) {
            logger.error("参数trackLogs值为空:{}", enCodeTrackLogs);
            return;
        }
        // URI解码
        String decodedTrackLogs = URLDecoder.decode(enCodeTrackLogs, StandardCharsets.UTF_8);

        // 解析JSON字符串为TrackLog对象
        List<TrackLog> trackLogs = JSON.parseArray(decodedTrackLogs, TrackLog.class);

        // 保存日志
        for (TrackLog trackLog : trackLogs) {
            this.saveTrackLog(request, trackLog);
        }

    }
}
