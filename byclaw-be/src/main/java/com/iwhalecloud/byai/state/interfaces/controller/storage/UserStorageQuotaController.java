package com.iwhalecloud.byai.state.interfaces.controller.storage;

import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.application.service.storage.UserStorageDowngradeApplicationService;
import com.iwhalecloud.byai.manager.application.service.storage.UserStorageQuotaApplicationService;
import com.iwhalecloud.byai.manager.dto.storage.UserStorageDowngradeCommand;
import com.iwhalecloud.byai.manager.dto.storage.UserStorageDowngradeQuery;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;

@RestController
@RequestMapping("/storage")
public class UserStorageQuotaController {

    @Autowired
    private UserStorageQuotaApplicationService quotaService;

    @Autowired
    private UserStorageDowngradeApplicationService downgradeService;

    @GetMapping("/quota")
    public ResponseUtil<Map<String, Object>> quota() {
        return ResponseUtil.successResponse(quotaService.buildQuotaView(CurrentUserHolder.getCurrentUserId()));
    }

    @GetMapping("/grants")
    public ResponseUtil<?> grants() {
        return ResponseUtil.successResponse(quotaService.listUserActiveGrants(CurrentUserHolder.getCurrentUserId()));
    }

    @GetMapping("/packages")
    public ResponseUtil<?> packages() {
        return ResponseUtil.successResponse(quotaService.listEnabledPackages());
    }

    @PostMapping({"/changes/cancel/preview", "/cancellations/preview"})
    public ResponseUtil<?> previewCancellation(@RequestBody UserStorageDowngradeCommand command) {
        Long userId = CurrentUserHolder.getCurrentUserId();
        return ResponseUtil.successResponse(command.getGrantIds() == null || command.getGrantIds().isEmpty()
            ? downgradeService.previewCancellation(command.getGrantId(), userId)
            : downgradeService.previewCancellation(command.getGrantIds(), userId));
    }

    @PostMapping("/changes/add/apply")
    public ResponseUtil<?> applyAddition(@RequestBody UserStorageDowngradeCommand command) {
        return ResponseUtil.successResponse(downgradeService.applyAddition(command));
    }

    @PostMapping({"/changes/cancel/apply", "/cancellations/apply"})
    public ResponseUtil<?> applyCancellation(@RequestBody UserStorageDowngradeCommand command) {
        return ResponseUtil.successResponse(downgradeService.applyCancellation(command));
    }

    @PostMapping({"/changes/withdraw", "/cancellations/withdraw"})
    public ResponseUtil<?> withdrawCancellation(@RequestBody UserStorageDowngradeCommand command) {
        return ResponseUtil.successResponse(downgradeService.withdrawChange(command.getDowngradeId()));
    }

    @GetMapping("/cancellations")
    public ResponseUtil<?> cancellations() {
        return ResponseUtil.successResponse(downgradeService.listCurrentUserHistory());
    }

    @PostMapping("/changes/page")
    public ResponseUtil<?> changes(@RequestBody(required = false) UserStorageDowngradeQuery query) {
        return ResponseUtil.successResponse(downgradeService.listCurrentUserPage(query));
    }

    @PostMapping({"/changes/archive", "/cancellations/archive"})
    public ResponseUtil<?> archiveCancellation(@RequestBody UserStorageDowngradeCommand command) {
        return ResponseUtil.successResponse(downgradeService.archiveNow(command.getDowngradeId(),
            CurrentUserHolder.getCurrentUserId()));
    }
}
