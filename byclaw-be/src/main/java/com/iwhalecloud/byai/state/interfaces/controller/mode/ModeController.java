package com.iwhalecloud.byai.state.interfaces.controller.mode;

import com.iwhalecloud.byai.manager.dto.mode.ModeDto;
import com.iwhalecloud.byai.state.domain.mode.service.ModeService;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import java.util.List;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 模式与数字员工关联控制器
 *
 * @author system
 */
@RestController
@RequestMapping("/mode")

public class ModeController {

    @Autowired
    private ModeService modeService;


    /**
     * 按条件查询关联列表（支持按模式编码、资源ID或两者组合）
     * @return 关联列表
     */

    @GetMapping("/getModeList")
    public ResponseUtil<List<ModeDto>> getModelList() {
        return ResponseUtil.successResponse(modeService.getModelList());

    }
}
