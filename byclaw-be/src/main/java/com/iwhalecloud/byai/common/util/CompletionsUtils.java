package com.iwhalecloud.byai.common.util;

import java.util.ArrayList;
import java.util.List;

import com.iwhalecloud.byai.common.login.bean.UserStation;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;

@Slf4j
public final class CompletionsUtils {
    private CompletionsUtils() {

    }

    public static void setResHeader(HttpServletResponse res) {
        res.setHeader("Content-Type", "text/event-stream;charset=utf-8");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("X-Accel-Buffering", "no");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setCharacterEncoding("UTF-8");
    }

    /*
     * 查询当前用户驻地的 所有父驻地 包含当前自己的驻地
     * */
    public static List<Long> getStationIds(UserStation userStation) {
        if (userStation == null) {
            return new ArrayList<>();
        }
        // 检查路径是否有效
        if (StringUtil.isEmpty(userStation.getStationIdPath())) {
            return new ArrayList<>();
        }

        List<Long> grantToObjIds = new ArrayList<>();
        String[] splitPathCode = userStation.getStationIdPath().split("\\.");
        for (String code : splitPathCode) {
            long stationId = Long.parseLong(code);
            if (stationId < 0) {
                continue;
            }
            grantToObjIds.add(stationId);
        }
        return grantToObjIds;
    }
}
