package com.iwhalecloud.byai.state.domain.ws.handler;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import com.iwhalecloud.byai.state.domain.ws.service.AuthService;
import com.iwhalecloud.byai.state.infrastructure.utils.CloseUtil;
import com.iwhalecloud.byai.state.infrastructure.utils.NettyResponse;
import com.iwhalecloud.byai.state.domain.ws.config.WebSocketProperties;
import io.netty.channel.ChannelHandler;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.ChannelInboundHandlerAdapter;
import io.netty.handler.codec.http.FullHttpRequest;
import io.netty.util.ReferenceCountUtil;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@ChannelHandler.Sharable
@Component
public class HttpRequestHandler extends ChannelInboundHandlerAdapter {

    @Autowired
    private AuthService authService;

    @Autowired
    private WebSocketProperties webSocketProperties;

    @Override
    public void channelRead(ChannelHandlerContext ctx, Object msg) throws Exception {
        if (!(msg instanceof FullHttpRequest request)) {
            ctx.fireChannelRead(msg);
            return;
        }

        try {
            String uri = request.uri();
            String path = uri.contains("?") ? uri.substring(0, uri.indexOf("?")) : uri;

            if (webSocketProperties.getWebsocketPath().equalsIgnoreCase(path)) {
                authService.auth(ctx, request);
                ctx.fireChannelRead(request.retain());
            }
            else {
                NettyResponse.sendNotFoundResponse(ctx);
            }
        }
        catch (Exception e) {
            log.error("Error in HttpRequestHandler", e);
            NettyResponse.sendErrorResponse(ctx, e.getMessage());
        }
        finally {
            ReferenceCountUtil.release(msg);
        }
    }

    @Override
    public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
        log.error("HttpRequestHandler error", cause);
        CloseUtil.close(ctx);
    }
}