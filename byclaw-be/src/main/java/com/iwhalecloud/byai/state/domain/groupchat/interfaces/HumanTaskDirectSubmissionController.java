package com.iwhalecloud.byai.state.domain.groupchat.interfaces;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.domain.groupchat.application.HumanTaskDirectSubmissionService;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

/** 直接回复的专用入口，文件随请求提交而非使用群消息上传协议。 */
@RestController
@RequestMapping("/group-human-tasks")
public class HumanTaskDirectSubmissionController {
    private final HumanTaskDirectSubmissionService submissions;
    public HumanTaskDirectSubmissionController(HumanTaskDirectSubmissionService submissions) { this.submissions = submissions; }

    @PostMapping(value = "/{humanTaskId}/submissions/direct", consumes = "multipart/form-data")
    public ResponseUtil<JSONObject> submit(@PathVariable Long humanTaskId, @RequestParam String requestId,
        @RequestParam(required = false) String text, @RequestPart(required = false) MultipartFile[] files) throws Exception {
        return ResponseUtil.successResponse(submissions.submit(humanTaskId, requestId, text, files));
    }
}
