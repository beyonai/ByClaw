package com.iwhalecloud.byai.manager.interfaces.controller.digitemploy;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.application.service.digitemploy.MetaPromptService;
import com.iwhalecloud.byai.manager.dto.digitemploy.MetaPromptGenerateRequest;
import com.iwhalecloud.byai.manager.dto.digitemploy.MetaPromptGenerateResult;
import com.iwhalecloud.byai.manager.dto.digitemploy.SkillMetaPromptGenerateRequest;
import com.iwhalecloud.byai.manager.dto.digitemploy.SkillMetaPromptGenerateResult;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.infrastructure.utils.CompletionsUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;

import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/meta/prompt/v3")
public class MetaPromptController {

    @Autowired
    private MetaPromptService metaPromptService;

    @RequestMapping(value = "/digitalmploy", method = RequestMethod.POST)
    public ResponseUtil<Map<String, Object>> generateDigitalEmployPrompt(
            @Valid @RequestBody MetaPromptGenerateRequest request) {
        MetaPromptGenerateResult result = metaPromptService.generateV3(request);
        Map<String, Object> flatResponse = new LinkedHashMap<>(result.getFields());
        flatResponse.put("contextSummary", result.getContextSummary());
        return ResponseUtil.successResponse(I18nUtil.get("meta.prompt.v3.success"), flatResponse);
    }

    @PostMapping(value = "/digitalmploy/stream", produces = "text/event-stream;charset=UTF-8")
    public void generateDigitalEmployPromptStream(
            @Valid @RequestBody MetaPromptGenerateRequest request,
            HttpServletResponse response) throws IOException {
        CompletionsUtils.setResHeader(response, true);
        metaPromptService.generateV3Stream(request, response.getOutputStream());
    }

    @RequestMapping(value = "/skill", method = RequestMethod.POST)
    public ResponseUtil<SkillMetaPromptGenerateResult> generateSkillPrompt(
        @Valid @RequestBody SkillMetaPromptGenerateRequest request) {
        SkillMetaPromptGenerateResult result = metaPromptService.generateSkill(request);
        return ResponseUtil.successResponse(I18nUtil.get("meta.prompt.v3.success"), result);
    }
}
