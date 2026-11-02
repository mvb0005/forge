package forge.web;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import io.netty.bootstrap.ServerBootstrap;
import io.netty.buffer.Unpooled;
import io.netty.channel.Channel;
import io.netty.channel.ChannelFutureListener;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.ChannelInitializer;
import io.netty.channel.EventLoopGroup;
import io.netty.channel.SimpleChannelInboundHandler;
import io.netty.channel.nio.NioEventLoopGroup;
import io.netty.channel.socket.SocketChannel;
import io.netty.channel.socket.nio.NioServerSocketChannel;
import io.netty.handler.codec.http.DefaultFullHttpResponse;
import io.netty.handler.codec.http.FullHttpRequest;
import io.netty.handler.codec.http.FullHttpResponse;
import io.netty.handler.codec.http.HttpHeaderNames;
import io.netty.handler.codec.http.HttpMethod;
import io.netty.handler.codec.http.HttpObjectAggregator;
import io.netty.handler.codec.http.HttpResponseStatus;
import io.netty.handler.codec.http.HttpServerCodec;
import io.netty.handler.codec.http.HttpUtil;
import io.netty.handler.codec.http.HttpVersion;
import io.netty.util.concurrent.DefaultEventExecutorGroup;
import io.netty.util.concurrent.EventExecutorGroup;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * The control API (PROTOCOL.md "Control API"): how mtg-tracker starts, watches and ends the match here, and
 * the opponents and deck checks its play page needs. Its own port, never routed by the tunnel; every call but
 * /healthz carries the shared secret when one is configured.
 */
final class ControlServer {
    private final int port;
    private final MatchHost host;
    private final byte[] secret;
    private EventLoopGroup group;
    // Starting a match waits on the UI thread; keep that off the I/O thread.
    private final EventExecutorGroup handlers = new DefaultEventExecutorGroup(2);

    ControlServer(int port, MatchHost host, String secret) {
        this.port = port;
        this.host = host;
        this.secret = secret == null ? null : secret.getBytes(StandardCharsets.UTF_8);
    }

    void start(String bind) throws InterruptedException {
        group = new NioEventLoopGroup(1);
        Channel ch = new ServerBootstrap()
                .group(group)
                .channel(NioServerSocketChannel.class)
                .childHandler(new ChannelInitializer<SocketChannel>() {
                    @Override
                    protected void initChannel(SocketChannel c) {
                        c.pipeline().addLast(new HttpServerCodec());
                        c.pipeline().addLast(new HttpObjectAggregator(1 << 20));
                        c.pipeline().addLast(handlers, new Handler());
                    }
                })
                .bind(bind, port).sync().channel();
        System.out.println("Control API on http://" + bind + ":" + port + "/" + (secret == null ? " (no secret)" : ""));
    }

    private boolean authorized(FullHttpRequest req) {
        if (secret == null) {
            return true;
        }
        String h = req.headers().get(HttpHeaderNames.AUTHORIZATION);
        if (h == null || !h.startsWith("Bearer ")) {
            return false;
        }
        return MessageDigest.isEqual(secret, h.substring("Bearer ".length()).getBytes(StandardCharsets.UTF_8));
    }

    private final class Handler extends SimpleChannelInboundHandler<FullHttpRequest> {
        @Override
        protected void channelRead0(ChannelHandlerContext ctx, FullHttpRequest req) {
            String path = req.uri();
            int q = path.indexOf('?');
            if (q >= 0) {
                path = path.substring(0, q);
            }
            HttpMethod m = req.method();
            FullHttpResponse res;
            try {
                if (path.equals("/healthz") && m == HttpMethod.GET) {
                    res = json(HttpResponseStatus.OK, ok());
                } else if (!authorized(req)) {
                    res = error(HttpResponseStatus.UNAUTHORIZED, "Missing or wrong control secret");
                } else if (path.equals("/opponents") && m == HttpMethod.GET) {
                    JsonObject o = new JsonObject();
                    o.add("opponents", Decks.curatedOpponents());
                    res = json(HttpResponseStatus.OK, o);
                } else if (path.equals("/decks/check") && m == HttpMethod.POST) {
                    String problem = MatchHost.checkDeck(body(req));
                    JsonObject o = new JsonObject();
                    o.addProperty("ok", problem == null);
                    if (problem != null) {
                        o.addProperty("error", problem);
                    }
                    res = json(HttpResponseStatus.OK, o);
                } else if (path.equals("/decks/import-url") && m == HttpMethod.POST) {
                    res = json(HttpResponseStatus.OK, MatchHost.importUrl(body(req)));
                } else if (path.equals("/match") && m == HttpMethod.GET) {
                    res = json(HttpResponseStatus.OK, host.status());
                } else if (path.equals("/match") && m == HttpMethod.POST) {
                    res = json(HttpResponseStatus.CREATED, host.start(body(req)));
                } else if (path.startsWith("/match/") && m == HttpMethod.DELETE) {
                    res = host.end(path.substring("/match/".length()))
                            ? json(HttpResponseStatus.ACCEPTED, ok())
                            : error(HttpResponseStatus.NOT_FOUND, "No running match with that id");
                } else {
                    res = error(HttpResponseStatus.NOT_FOUND, "Not found");
                }
            } catch (MatchHost.Refused e) {
                res = error(HttpResponseStatus.valueOf(e.status), e.getMessage());
            } catch (IllegalStateException | com.google.gson.JsonParseException | UnsupportedOperationException e) {
                res = error(HttpResponseStatus.BAD_REQUEST, "Bad request: " + e.getMessage());
            } catch (Exception e) {
                e.printStackTrace();
                res = error(HttpResponseStatus.INTERNAL_SERVER_ERROR, "Could not do that: " + e);
            }
            HttpUtil.setContentLength(res, res.content().readableBytes());
            ctx.writeAndFlush(res).addListener(ChannelFutureListener.CLOSE);
        }

        @Override
        public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
            ctx.close();
        }
    }

    private static JsonObject body(FullHttpRequest req) {
        return JsonParser.parseString(req.content().toString(StandardCharsets.UTF_8)).getAsJsonObject();
    }

    private static JsonObject ok() {
        JsonObject o = new JsonObject();
        o.addProperty("ok", true);
        return o;
    }

    private static FullHttpResponse error(HttpResponseStatus s, String message) {
        JsonObject o = new JsonObject();
        o.addProperty("error", message);
        return json(s, o);
    }

    private static FullHttpResponse json(HttpResponseStatus s, JsonObject body) {
        FullHttpResponse res = new DefaultFullHttpResponse(HttpVersion.HTTP_1_1, s, Unpooled.copiedBuffer(body.toString(), StandardCharsets.UTF_8));
        res.headers().set(HttpHeaderNames.CONTENT_TYPE, "application/json; charset=utf-8");
        res.headers().set(HttpHeaderNames.CACHE_CONTROL, "no-store");
        return res;
    }
}
