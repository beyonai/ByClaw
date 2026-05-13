package com.iwhalecloud.byai.state.interfaces.controller.index;

import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.iwhalecloud.byai.state.application.service.index.IndexApplicationServiceV2;
import com.iwhalecloud.byai.manager.qo.index.DiscoverQo;
import com.iwhalecloud.byai.manager.qo.index.HotQo;
import com.iwhalecloud.byai.manager.qo.index.MyAuthEmployQo;
import com.iwhalecloud.byai.manager.qo.index.MyCreatedQo;
import com.iwhalecloud.byai.manager.qo.index.MyUsualQo;
import com.iwhalecloud.byai.manager.qo.index.RecentlyAddedQo;
import com.iwhalecloud.byai.manager.vo.index.AuthDigitEmployVo;
import com.iwhalecloud.byai.manager.vo.index.DepartmentRangeVo;
import com.iwhalecloud.byai.manager.vo.index.DigitEmployMarketVo;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import io.opentelemetry.instrumentation.annotations.AddingSpanAttributes;
import io.opentelemetry.instrumentation.annotations.SpanAttribute;
import io.opentelemetry.instrumentation.annotations.WithSpan;

/**
 * @author zht
 * @version 2.0
 * @date 2025/4/25
 */
@RestController
@RequestMapping("/api/v2/digitEmploy")
public class DigitEmployManControllerV2 {

    @Autowired
    private IndexApplicationServiceV2 digitEmployManServiceV2;

    /**
     * 我创建的和我订阅的数字员工
     * 
     * @param myAuthEmployQo 查询对象
     * @return ResponseUtil
     */
    @PostMapping("/queryMyCreatedAndSubscribedAgents")
    public ResponseUtil queryMyAuthEmploy(@RequestBody MyAuthEmployQo myAuthEmployQo) {
        PageInfo<AuthDigitEmployVo> pageInfo = digitEmployManServiceV2.queryMyAuthEmploy(myAuthEmployQo);
        return ResponseUtil.successResponse(pageInfo);
    }

    /**
     * 我常用的（按用户近 90 天使用频次降序排列）
     * 
     * @param myUsualQo
     * @return ResponseUtil
     */
    @PostMapping("/queryMyUsual")
    public ResponseUtil queryMyUsual(@RequestBody MyUsualQo myUsualQo) {
        PageInfo<AuthDigitEmployVo> pageInfo = digitEmployManServiceV2.queryMyUsual(myUsualQo);
        return ResponseUtil.successResponse(pageInfo);
    }

    /**
     * 最近添加（按用户添加/被授权的数字员工的时间降序排列）
     * 
     * @param recentlyAddedQo
     * @return ResponseUtil
     */
    @PostMapping("/queryRecentlyAdded")
    public ResponseUtil queryRecentlyAdded(@RequestBody RecentlyAddedQo recentlyAddedQo) {
        PageInfo<AuthDigitEmployVo> pageInfo = digitEmployManServiceV2.queryRecentlyAdded(recentlyAddedQo);
        return ResponseUtil.successResponse(pageInfo);
    }

    /**
     * 我创建的数字员工
     *
     * @param myCreatedQo 查询条件
     * @return ResponseUtil
     */
    @PostMapping("/queryMyCreated")
    public ResponseUtil queryMyCreated(@RequestBody MyCreatedQo myCreatedQo) {
        PageInfo<DigitEmployMarketVo> pageInfo = digitEmployManServiceV2.queryMyCreated(myCreatedQo);
        return ResponseUtil.successResponse(pageInfo);
    }

    /**
     * 发现数字员工
     * 
     * @param discoverQo 查询条件
     * @return ResponseUtil
     */
    @PostMapping("/discover")
    @WithSpan("发现数字员工")
    @AddingSpanAttributes
    public ResponseUtil discover(@SpanAttribute("discoverQo") @RequestBody DiscoverQo discoverQo) {
        PageInfo<DigitEmployMarketVo> pageInfo = digitEmployManServiceV2.discover(discoverQo);
        return ResponseUtil.successResponse(pageInfo);
    }

    /**
     * 查询热门对象
     * 
     * @param hotQo 查询对象
     * @return ResponseUtil
     */
    @PostMapping("/queryPopular")
    public ResponseUtil queryPopular(@RequestBody HotQo hotQo) {
        PageInfo<DigitEmployMarketVo> pageInfo = digitEmployManServiceV2.queryPopular(hotQo);
        return ResponseUtil.successResponse(pageInfo);
    }

    /**
     * 查询我的部门范围
     *
     * @return ResponseUtil
     */
    @PostMapping("/queryMyDepartmentRange")
    public ResponseUtil queryMyDepartmentRange() {
        List<DepartmentRangeVo> resultList = digitEmployManServiceV2.queryMyDepartmentRange();
        return ResponseUtil.successResponse(resultList);
    }

}
