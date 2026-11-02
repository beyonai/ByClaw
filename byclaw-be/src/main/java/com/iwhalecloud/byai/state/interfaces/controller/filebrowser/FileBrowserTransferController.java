package com.iwhalecloud.byai.state.interfaces.controller.filebrowser;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.application.service.filebrowser.FileBrowserTransferApplicationService;
import com.iwhalecloud.byai.state.application.service.filebrowser.FileBrowserTransferApplicationService.UploadRequest;
import java.io.IOException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/fileBrowser/uploads")
public class FileBrowserTransferController {
    private final FileBrowserTransferApplicationService transfers;

    public FileBrowserTransferController(FileBrowserTransferApplicationService transfers) {
        this.transfers = transfers;
    }

    @GetMapping("/capabilities")
    public ResponseUtil capabilities() {
        if (org.apache.commons.lang3.StringUtils.isBlank(CurrentUserHolder.getCurrentUserCode())) {
            return ResponseUtil.fail("Authentication required");
        }
        return ResponseUtil.successResponse(transfers.capabilities());
    }

    @PostMapping("/{operation:create|status|complete|abort}")
    public ResponseUtil control(@PathVariable("operation") String operation, @RequestBody UploadRequest request) {
        return ResponseUtil.successResponse(transfers.control(CurrentUserHolder.getCurrentUserCode(), operation, request));
    }

    @PostMapping("/chunk")
    public ResponseUtil chunk(@RequestParam("resourceId") Long resourceId, @RequestParam("path") String path,
            @RequestParam("fileName") String fileName, @RequestParam("uploadId") String uploadId,
            @RequestParam("index") int index, @RequestParam("sha256") String sha256,
            @RequestParam("chunk") MultipartFile chunk) throws IOException {
        return ResponseUtil.successResponse(transfers.chunk(CurrentUserHolder.getCurrentUserCode(),
            new UploadRequest(resourceId, path, fileName, uploadId, null, null, null), index, sha256, chunk));
    }
}
