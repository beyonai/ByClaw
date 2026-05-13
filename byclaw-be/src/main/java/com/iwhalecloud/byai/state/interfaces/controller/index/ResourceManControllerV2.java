package com.iwhalecloud.byai.state.interfaces.controller.index;

/**
 * @author he.duming
 * @date 2025-12-02 15:02:20
 * @description TODO
 */
import com.iwhalecloud.byai.state.application.service.index.IndexApplicationServiceV2;
import com.iwhalecloud.byai.manager.qo.index.AuthResourceQo;
import com.iwhalecloud.byai.manager.vo.index.AuthResourceVo;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v2/resource")
public class ResourceManControllerV2 {

    @Autowired
    private IndexApplicationServiceV2 digitEmployManServiceV2;

    /**
     * 查询授权的文档
     *
     * @return ResponseUtil
     */
    @PostMapping("/queryAuthDoc")
    public ResponseUtil<PageInfo<AuthResourceVo>> queryAuthDoc(@RequestBody AuthResourceQo authResourceQo) {
        PageInfo<AuthResourceVo> page = digitEmployManServiceV2.queryAuthDoc(authResourceQo);
        return ResponseUtil.successResponse(page);
    }

    /**
     * 查询授权的工具
     *
     * @return ResponseUtil
     */
    @PostMapping("/queryAuthTools")
    public ResponseUtil<PageInfo<AuthResourceVo>> queryAuthTools(@RequestBody AuthResourceQo authResourceQo) {
        PageInfo<AuthResourceVo> page = digitEmployManServiceV2.queryAuthTools(authResourceQo);
        return ResponseUtil.successResponse(page);
    }
}
