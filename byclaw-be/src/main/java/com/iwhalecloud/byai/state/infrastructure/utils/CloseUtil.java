package com.iwhalecloud.byai.state.infrastructure.utils;


import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.state.domain.ws.constant.Constant;
import com.iwhalecloud.byai.state.domain.ws.manager.ChannelManager;

import io.netty.channel.ChannelHandlerContext;
import lombok.extern.slf4j.Slf4j;

@Slf4j
public class CloseUtil {
    public static void close(ChannelHandlerContext ctx){
        try {
            LoginInfo userInfo = ctx.attr(Constant.ATT_USER_INFO).get();
            ChannelManager.removeChannel(userInfo.getUserId(), ctx.channel());
        }
        catch (Exception e){
            log.warn(e.getMessage(), e);
        }
        ctx.close();
    }
}
