package com.iwhalecloud.byai.manager.interfaces.controller.log;

import com.iwhalecloud.byai.manager.application.service.log.TrackLogApplicationService;
import com.iwhalecloud.byai.state.domain.log.dto.BatchTrackLogDto;
import com.iwhalecloud.byai.manager.entity.log.TrackLog;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * @author he.duming
 * @date 2025-12-25 15:43:45
 * @description TODO
 */
@RestController
@RequestMapping("/trackLogController")
public class TrackLogController {

    private static final Logger logger = LoggerFactory.getLogger(TrackLogController.class);

    @Autowired
    private TrackLogApplicationService trackLogApplicationService;

    /**
     * 单个保存埋点日志
     *
     * @return ResponseUtil
     */
    @PostMapping("/saveTrackLog")
    public ResponseUtil<String> saveTrackLog(HttpServletRequest request, @RequestBody TrackLog trackLog) {
        try {
            trackLogApplicationService.saveTrackLog(request, trackLog);
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
        }
        return ResponseUtil.successResponse();
    }

    /**
     * 批量保存埋点日志
     *
     * @param request 请求对象
     * @param batchTrackLogDto 批量保存入参
     * @return ResponseUtil
     */
    @PostMapping("/batchSaveTrackLog")
    public ResponseUtil<String> batchSaveTrackLog(HttpServletRequest request,
                                              @RequestBody BatchTrackLogDto batchTrackLogDto) {
        try {
            trackLogApplicationService.batchSaveTrackLog(request, batchTrackLogDto);
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
        }
        return ResponseUtil.successResponse();
    }

    /**
     * GET方式保存埋点日志（参数使用URI编码）
     *
     * @param request 请求对象
     * @param enCodeTrackLogs URI编码后的JSON字符串
     * @return ResponseUtil
     */
    @GetMapping("/saveTrackLogByURLEnCode")
    public ResponseUtil<String> saveTrackLogByURLEnCode(HttpServletRequest request,
                                                    @RequestParam(value = "enCodeTrackLogs", required = false) String enCodeTrackLogs) {
        try {
            trackLogApplicationService.saveTrackLogByURLEnCode(request, enCodeTrackLogs);
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
        }
        return ResponseUtil.successResponse();
    }
}
