package com.iwhalecloud.byai.manager.interfaces.controller.digitemploy;

import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.manager.application.service.digitemploy.EmployeeVersionCommands;
import com.iwhalecloud.byai.manager.dto.digitemploy.EmployeeVersionRequest;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/digitalEmployeeVersions")
@RequiredArgsConstructor
public class EmployeeVersionController {
    private final EmployeeVersionCommands commands;
    public record HistoryRequest(@jakarta.validation.constraints.NotNull Long resourceId, int page, int size) { }
    @PostMapping("/history")
    public ResponseUtil<EmployeeVersionCommands.History> history(@Valid @RequestBody HistoryRequest request) {
        return ResponseUtil.successResponse(commands.history(request.resourceId(), Math.max(1, request.page()),
            request.size() <= 0 ? 20 : request.size()));
    }
    @GetMapping("/detail")
    public ResponseUtil<EmployeeVersionCommands.Version> detail(@RequestParam Long resourceId, @RequestParam Long versionId) {
        return ResponseUtil.successResponse(commands.detail(resourceId, versionId));
    }
    @PostMapping("/save")
    public ResponseUtil<EmployeeVersionCommands.Result> save(@Valid @RequestBody EmployeeVersionRequest request) {
        return ResponseUtil.successResponse(commands.save(request));
    }
    @PostMapping("/activate")
    public ResponseUtil<EmployeeVersionCommands.Result> activate(@Valid @RequestBody EmployeeVersionRequest request) {
        return ResponseUtil.successResponse(commands.activate(request));
    }
    @PostMapping("/retry")
    public ResponseUtil<EmployeeVersionCommands.Result> retry(@Valid @RequestBody EmployeeVersionRequest request) {
        return ResponseUtil.successResponse(commands.retry(request.getResourceId()));
    }
    @ExceptionHandler(BaseException.class)
    public ResponseUtil<Void> businessError(BaseException error) {
        // 保留已受控的业务原因，避免包含资源名称或中英文混排时被替换为通用错误。
        return new ResponseUtil<>(ResponseUtil.FAIL, error.getMessage(), null);
    }
}
