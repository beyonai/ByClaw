package com.iwhalecloud.byai.manager.interfaces.controller.position;

import com.iwhalecloud.byai.manager.application.service.position.DigitalPositionApplicationService;
import com.iwhalecloud.byai.manager.dto.position.DigitalPositionCreateDTO;
import com.iwhalecloud.byai.manager.dto.position.CatalogWithPositionsDTO;
import com.iwhalecloud.byai.manager.dto.position.DigitalPositionUpdateDTO;
import com.iwhalecloud.byai.manager.dto.position.PositionUserBindDTO;
import com.iwhalecloud.byai.manager.entity.position.Position;
import com.iwhalecloud.byai.manager.entity.position.PositionUserRelation;
import com.iwhalecloud.byai.manager.qo.position.DigitalPositionSearchQO;
import com.iwhalecloud.byai.manager.qo.position.PositionAdminSearchQO;
import com.iwhalecloud.byai.manager.vo.position.PositionUsersVo;
import com.iwhalecloud.byai.common.annotation.ManageLogAnnotation;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 数字岗位控制器
 */
@RestController
@RequestMapping("/system/digitalPosition")
@Validated
public class DigitalPositionController {

    @Autowired
    private DigitalPositionApplicationService digitalPositionApplicationService;

    /**
     * 创建数字岗位（岗位绑定领域，支持多选）
     *
     * @param request 请求
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "数字岗位管理", description = "创建数字岗位")
    @PostMapping("/create")
    public ResponseUtil<Position> create(@Valid @RequestBody DigitalPositionCreateDTO request) {
        Position digitalPosition = digitalPositionApplicationService.createDigitalPosition(request);
        return ResponseUtil.successResponse(digitalPosition);
    }

    /**
     * 查询数字岗位列表（支持按领域过滤和岗位名称搜索，分页）
     *
     * @param searchQO 查询对象
     * @return PageInfo<CatalogWithPositionsDTO>
     */
    @PostMapping("/search")
    public ResponseUtil<List<CatalogWithPositionsDTO>> search(@RequestBody DigitalPositionSearchQO searchQO) {
        List<CatalogWithPositionsDTO> result = digitalPositionApplicationService.searchDigitalPositions(searchQO);
        return ResponseUtil.successResponse(result);
    }

    /**
     * 更新数字岗位
     *
     * @param request 更新请求
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "数字岗位管理", description = "更新数字岗位")
    @PostMapping("/update")
    public ResponseUtil<Position> update(@Valid @RequestBody DigitalPositionUpdateDTO request) {
        Position position = digitalPositionApplicationService.updateDigitalPosition(request);
        return ResponseUtil.successResponse(position);
    }

    /**
     * 删除数字岗位
     *
     * @param positionId 岗位ID
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "数字岗位管理", description = "删除数字岗位")
    @PostMapping("/delete/{positionId}")
    public ResponseUtil<Position> delete(
        @PathVariable @NotNull(message = "{position.positionid.notnull}") Long positionId) {
        Position position = digitalPositionApplicationService.deleteDigitalPosition(positionId);
        return ResponseUtil.successResponse(position);
    }

    /**
     * 绑定岗位与用户关联
     *
     * @param request 绑定请求
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "数字岗位管理", description = "绑定岗位与用户")
    @PostMapping("/bindUser")
    public ResponseUtil<List<PositionUserRelation>> bindUser(@Valid @RequestBody PositionUserBindDTO request) {
        List<PositionUserRelation> positionUserRelations = digitalPositionApplicationService.bindPositionUser(request);
        return ResponseUtil.successResponse(positionUserRelations);
    }

    /**
     * 移除岗位与用户绑定
     *
     * @param request 解绑请求
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "数字岗位管理", description = "移除岗位与用户绑定")
    @PostMapping("/unbindUser")
    public ResponseUtil<PositionUserRelation> unbindUser(@Valid @RequestBody PositionUserBindDTO request) {
        digitalPositionApplicationService.unbindPositionUser(request);
        return ResponseUtil.successResponse();
    }

    /**
     * 查询数字岗位下的管理员用户信息（分页）
     *
     * @param searchQO 查询对象
     * @return PageInfo<UsersDetailVo>
     */
    @PostMapping("/searchAdmins")
    public ResponseUtil<PageInfo<PositionUsersVo>> searchAdmins(@RequestBody @Valid PositionAdminSearchQO searchQO) {
        PageInfo<PositionUsersVo> result = digitalPositionApplicationService.searchPositionAdmins(searchQO);
        return ResponseUtil.successResponse(result);
    }
}
