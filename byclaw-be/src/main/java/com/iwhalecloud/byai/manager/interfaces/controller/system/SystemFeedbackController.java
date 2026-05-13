package com.iwhalecloud.byai.manager.interfaces.controller.system;

import com.iwhalecloud.byai.manager.application.service.system.SystemFeedbackApplicationService;
import com.iwhalecloud.byai.manager.dto.system.SystemFeedbackDTO;
import com.iwhalecloud.byai.common.annotation.Add;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.common.redis.CustomJedisPoolConfig;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import java.util.Map;

/**
 * @author he.duming
 * @date 2025-08-19 19:48:13
 * @description TODO
 */

@RestController
@RequestMapping("/system/feedback")
public class SystemFeedbackController {

    private static final Logger logger = LoggerFactory.getLogger(SystemFeedbackController.class);

    @Autowired
    private SystemFeedbackApplicationService systemFeedbackApplicationService;

    /**
     * 保存系统反馈信息
     *
     * @param systemFeedbackDTO 反馈信息
     * @return ResponseUtil
     */
    @RequestMapping(value = "/save", method = RequestMethod.POST)
    public ResponseUtil<String> save(HttpServletRequest request,
        @Validated(Add.class) @RequestBody SystemFeedbackDTO systemFeedbackDTO) {
        systemFeedbackApplicationService.save(request, systemFeedbackDTO);
        return ResponseUtil.success("OK");
    }

    /**
     * 上传文件反馈信息
     *
     * @param files 上传的文档
     * @return ResponseUtil
     */
    @RequestMapping(value = "/uploadFeedbackFile", method = RequestMethod.POST,
        produces = "application/json;charset=UTF-8", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseUtil<Map<String, Object>> uploadFeedbackFile(@RequestPart("files") MultipartFile[] files) {
        try {
            Map<String, Object> resultMap = systemFeedbackApplicationService.uploadFeedbackFile(files);
            return ResponseUtil.successResponse(resultMap);
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
            return ResponseUtil.fail(e.getMessage());
        }
    }
}
