package com.iwhalecloud.byai.state.interfaces.controller.digitemploy;

import com.iwhalecloud.byai.state.domain.agent.service.SsSuperassistSubAgentService;
import com.iwhalecloud.byai.state.domain.assitsant.vo.IsTopVo;
import com.iwhalecloud.byai.state.domain.chat.dto.AgentDebugChatDto;
import com.iwhalecloud.byai.state.domain.chat.service.AssistantChatService;
import com.iwhalecloud.byai.state.domain.template.enums.DebugModeEnum;
import com.iwhalecloud.byai.state.infrastructure.utils.CompletionsUtils;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.extern.slf4j.Slf4j;
import java.io.IOException;
import java.io.OutputStream;

/**
 * @author zht
 * @version 1.0
 * @date 2025/4/25
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/digitEmploy")
@Tag(name = "数字员工管理", description = "提供数字员工的创建、编辑、查询、发布等功能")
public class DigitEmployManController {

    @Autowired
    private AssistantChatService assistantChatService;

    @Autowired
    private SsSuperassistSubAgentService ssSuperassistSubAgentService;

    @PostMapping("/debugChat")
    @Operation(summary = "数字员工调试接口", description = "调试数字员工，支持文本和文件上传")
    @ApiResponses({
        @ApiResponse(responseCode = "0", description = "调试成功",
            content = @Content(mediaType = "application/json", schema = @Schema(implementation = ResponseUtil.class))),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public void debugChat(HttpServletResponse response, @RequestBody AgentDebugChatDto debugChatDto)
        throws IOException {
        if (CurrentUserHolder.getAssistantId() == null || CurrentUserHolder.getCurrentUserName() == null) {
            throw new BdpRuntimeException(I18nUtil.get("digit.employ.man.assistant.is.null"));
        }
        OutputStream outputStream = null;
        try {
            debugChatDto.setIsDebug(DebugModeEnum.DEBUG_1.getNum());
            CompletionsUtils.setResHeader(response, true);
            outputStream = response.getOutputStream();
            assistantChatService.chat(debugChatDto, outputStream, null);
        }
        catch (IOException e) {
            throw new BdpRuntimeException(e.getMessage(), e);
        }
        finally {
            outputStream.close();
        }
    }

    /**
     * 置顶/取消置操作
     *
     * @param isTopVo 操作对象
     * @return ResponseUtil
     */
    @PostMapping("/isTop")
    public ResponseUtil<?> isTopAgent(@RequestBody IsTopVo isTopVo) {
        ssSuperassistSubAgentService.isTopAgent(isTopVo);
        return ResponseUtil.successResponse();
    }

}
