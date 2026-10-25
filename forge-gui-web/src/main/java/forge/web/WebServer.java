package forge.web;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import forge.ImageKeys;
import forge.StaticData;
import forge.card.CardEdition;
import forge.item.PaperCard;
import forge.localinstance.properties.ForgeConstants;
import forge.util.ImageUtil;
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
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;
import io.netty.handler.codec.http.websocketx.WebSocketFrameAggregator;
import io.netty.handler.codec.http.websocketx.WebSocketServerProtocolHandler;

import java.io.File;
import java.io.IOException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/** Netty HTTP server: the /ws WebSocket, card images and the static UI. Binds 127.0.0.1 only. */
public final class WebServer {
    private static final String IMG_PREFIX = "/img/card/";

    private final int port;
    private final Path uiDir;
    private final MatchHost host;
    private EventLoopGroup boss;
    private EventLoopGroup workers;
    private Channel serverChannel;

    public WebServer(int port, Path uiDir, MatchHost host) {
        this.port = port;
        this.uiDir = uiDir == null ? null : uiDir.toAbsolutePath().normalize();
        this.host = host;
    }

    public void start() throws InterruptedException {
        boss = new NioEventLoopGroup(1);
        workers = new NioEventLoopGroup(2);
        ServerBootstrap b = new ServerBootstrap()
                .group(boss, workers)
                .channel(NioServerSocketChannel.class)
                .childHandler(new ChannelInitializer<SocketChannel>() {
                    @Override
                    protected void initChannel(SocketChannel ch) {
                        ch.pipeline().addLast(new HttpServerCodec());
                        ch.pipeline().addLast(new HttpObjectAggregator(1 << 20));
                        ch.pipeline().addLast(new WebSocketServerProtocolHandler("/ws", null, true, 1 << 20));
                        ch.pipeline().addLast(new WebSocketFrameAggregator(1 << 22));
                        ch.pipeline().addLast(new SocketHandler());
                        ch.pipeline().addLast(new HttpHandler());
                    }
                });
        serverChannel = b.bind("127.0.0.1", port).sync().channel();
    }

    public void awaitClose() throws InterruptedException {
        try {
            serverChannel.closeFuture().sync();
        } finally {
            boss.shutdownGracefully();
            workers.shutdownGracefully();
        }
    }

    private static final class NettyClient implements ClientChannel {
        private final Channel ch;

        NettyClient(Channel ch) {
            this.ch = ch;
        }

        @Override
        public void send(JsonObject message) {
            if (ch.isActive()) {
                ch.writeAndFlush(new TextWebSocketFrame(message.toString()));
            }
        }
    }

    private final class SocketHandler extends SimpleChannelInboundHandler<TextWebSocketFrame> {
        private NettyClient client;

        @Override
        public void userEventTriggered(ChannelHandlerContext ctx, Object evt) throws Exception {
            if (evt instanceof WebSocketServerProtocolHandler.HandshakeComplete) {
                client = new NettyClient(ctx.channel());
                host.onConnect(client);
            } else {
                super.userEventTriggered(ctx, evt);
            }
        }

        @Override
        protected void channelRead0(ChannelHandlerContext ctx, TextWebSocketFrame frame) {
            JsonObject msg;
            try {
                msg = JsonParser.parseString(frame.text()).getAsJsonObject();
            } catch (Exception e) {
                JsonObject err = new JsonObject();
                err.addProperty("t", "error");
                err.addProperty("message", "Bad JSON: " + e.getMessage());
                client.send(err);
                return;
            }
            host.onMessage(client, msg);
        }

        @Override
        public void channelInactive(ChannelHandlerContext ctx) throws Exception {
            if (client != null) {
                host.onDisconnect(client);
            }
            super.channelInactive(ctx);
        }

        @Override
        public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
            if (!(cause instanceof IOException)) {
                System.err.println("WebSocket error: " + cause);
            }
            ctx.close();
        }
    }

    private final class HttpHandler extends SimpleChannelInboundHandler<FullHttpRequest> {
        @Override
        protected void channelRead0(ChannelHandlerContext ctx, FullHttpRequest req) {
            if (req.method() != HttpMethod.GET && req.method() != HttpMethod.HEAD) {
                respond(ctx, req, status(HttpResponseStatus.METHOD_NOT_ALLOWED));
                return;
            }
            String path = req.uri();
            int q = path.indexOf('?');
            if (q >= 0) {
                path = path.substring(0, q);
            }
            FullHttpResponse res;
            try {
                if (path.startsWith(IMG_PREFIX)) {
                    res = cardImage(URLDecoder.decode(path.substring(IMG_PREFIX.length()), StandardCharsets.UTF_8));
                } else {
                    res = staticFile(URLDecoder.decode(path, StandardCharsets.UTF_8));
                }
            } catch (Exception e) {
                res = status(HttpResponseStatus.INTERNAL_SERVER_ERROR);
            }
            respond(ctx, req, res);
        }

        @Override
        public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
            ctx.close();
        }
    }

    private static void respond(ChannelHandlerContext ctx, FullHttpRequest req, FullHttpResponse res) {
        HttpUtil.setContentLength(res, res.content().readableBytes());
        boolean keepAlive = HttpUtil.isKeepAlive(req);
        if (keepAlive) {
            HttpUtil.setKeepAlive(res, true);
        }
        if (req.method() == HttpMethod.HEAD) {
            res.content().clear();
        }
        var f = ctx.writeAndFlush(res);
        if (!keepAlive) {
            f.addListener(ChannelFutureListener.CLOSE);
        }
    }

    private static FullHttpResponse status(HttpResponseStatus s) {
        FullHttpResponse res = new DefaultFullHttpResponse(HttpVersion.HTTP_1_1, s,
                Unpooled.copiedBuffer(s.toString(), StandardCharsets.UTF_8));
        res.headers().set(HttpHeaderNames.CONTENT_TYPE, "text/plain; charset=utf-8");
        return res;
    }

    private static FullHttpResponse file(Path p, String cacheControl) throws IOException {
        FullHttpResponse res = new DefaultFullHttpResponse(HttpVersion.HTTP_1_1, HttpResponseStatus.OK,
                Unpooled.wrappedBuffer(Files.readAllBytes(p)));
        res.headers().set(HttpHeaderNames.CONTENT_TYPE, contentType(p.getFileName().toString()));
        if (cacheControl != null) {
            res.headers().set(HttpHeaderNames.CACHE_CONTROL, cacheControl);
        }
        return res;
    }

    private FullHttpResponse cardImage(String key) throws IOException {
        File f = resolveImage(key);
        if (f != null && f.isFile()) {
            return file(f.toPath(), "max-age=86400");
        }
        String url = scryfallUrl(key);
        if (url == null) {
            return status(HttpResponseStatus.NOT_FOUND);
        }
        FullHttpResponse res = new DefaultFullHttpResponse(HttpVersion.HTTP_1_1, HttpResponseStatus.FOUND, Unpooled.EMPTY_BUFFER);
        res.headers().set(HttpHeaderNames.LOCATION, url);
        res.headers().set(HttpHeaderNames.CACHE_CONTROL, "max-age=86400");
        return res;
    }

    private FullHttpResponse staticFile(String path) throws IOException {
        if (uiDir == null) {
            return status(HttpResponseStatus.NOT_FOUND);
        }
        String rel = path.startsWith("/") ? path.substring(1) : path;
        Path p = uiDir.resolve(rel.isEmpty() ? "index.html" : rel).normalize();
        if (!p.startsWith(uiDir)) {
            return status(HttpResponseStatus.FORBIDDEN);
        }
        if (Files.isRegularFile(p)) {
            return file(p, p.getFileName().toString().equals("index.html") ? "no-cache" : null);
        }
        String last = p.getFileName() == null ? "" : p.getFileName().toString();
        Path index = uiDir.resolve("index.html");
        if (!last.contains(".") && Files.isRegularFile(index)) {
            return file(index, "no-cache");
        }
        return status(HttpResponseStatus.NOT_FOUND);
    }

    private static String contentType(String name) {
        String n = name.toLowerCase();
        if (n.endsWith(".jpg") || n.endsWith(".jpeg")) { return "image/jpeg"; }
        if (n.endsWith(".png")) { return "image/png"; }
        if (n.endsWith(".webp")) { return "image/webp"; }
        if (n.endsWith(".svg")) { return "image/svg+xml"; }
        if (n.endsWith(".html")) { return "text/html; charset=utf-8"; }
        if (n.endsWith(".js") || n.endsWith(".mjs")) { return "text/javascript; charset=utf-8"; }
        if (n.endsWith(".css")) { return "text/css; charset=utf-8"; }
        if (n.endsWith(".json") || n.endsWith(".map")) { return "application/json"; }
        if (n.endsWith(".woff2")) { return "font/woff2"; }
        if (n.endsWith(".ico")) { return "image/x-icon"; }
        return "application/octet-stream";
    }

    private static final String[][] FACES = {
            {ImageKeys.BACKFACE_POSTFIX, "back"},
            {ImageKeys.SPECFACE_W, "white"}, {ImageKeys.SPECFACE_U, "blue"}, {ImageKeys.SPECFACE_B, "black"},
            {ImageKeys.SPECFACE_R, "red"}, {ImageKeys.SPECFACE_G, "green"},
    };

    private record FaceKey(String key, String face) {
        static FaceKey of(String key) {
            for (String[] f : FACES) {
                if (key.endsWith(f[0])) {
                    return new FaceKey(key.substring(0, key.length() - f[0].length()), f[1]);
                }
            }
            return new FaceKey(key, "");
        }
    }

    // ImageKeys keeps unsynchronized caches, and requests arrive on several I/O threads
    static synchronized File resolveImage(String key) {
        if (key == null || key.isEmpty()) {
            return null;
        }
        FaceKey fk = FaceKey.of(key);
        if (fk.key().startsWith(ImageKeys.CARD_PREFIX)) {
            PaperCard pc = ImageUtil.getPaperCardFromImageKey(fk.key());
            if (pc == null) {
                return null;
            }
            String rel = switch (fk.face()) {
                case "" -> pc.getCardImageKey();
                case "back" -> pc.getCardAltImageKey();
                default -> ImageUtil.getImageKey(pc, fk.face(), true);
            };
            return rel == null || rel.isEmpty() ? null : ImageKeys.getImageFile(rel);
        }
        return ImageKeys.getImageFile(key);
    }

    static synchronized String scryfallUrl(String key) {
        try {
            FaceKey fk = FaceKey.of(key);
            if (fk.key().startsWith(ImageKeys.CARD_PREFIX)) {
                PaperCard pc = ImageUtil.getPaperCardFromImageKey(fk.key());
                if (pc == null || pc.getRules().isCustom()) {
                    return null;
                }
                CardEdition ed = StaticData.instance().getEditions().get(pc.getEdition());
                if (ed == null) {
                    return null;
                }
                return ForgeConstants.URL_PIC_SCRYFALL_DOWNLOAD
                        + ImageUtil.getScryfallDownloadUrl(pc, fk.face(), ed.getScryfallCode(), "en", false);
            }
            if (fk.key().startsWith(ImageKeys.TOKEN_PREFIX)) {
                String[] parts = fk.key().substring(ImageKeys.TOKEN_PREFIX.length()).split("\\|");
                if (parts.length < 2) {
                    return null;
                }
                CardEdition ed = StaticData.instance().getEditions().get(parts[1]);
                if (ed == null || ed.getType() == CardEdition.Type.CUSTOM_SET) {
                    return null;
                }
                String cn = parts.length > 2 ? parts[2] : null;
                if (cn == null || cn.isEmpty()) {
                    var entries = ed.getTokens().get(parts[0]);
                    for (CardEdition.EditionEntry e : entries) {
                        if (e.collectorNumber() != null && !e.collectorNumber().isEmpty()) {
                            cn = e.collectorNumber();
                            break;
                        }
                    }
                }
                if (cn == null || cn.isEmpty()) {
                    return null;
                }
                return ForgeConstants.URL_PIC_SCRYFALL_DOWNLOAD
                        + ImageUtil.getScryfallTokenDownloadUrl(cn, ed.getTokensCode(), "en", fk.face());
            }
        } catch (Exception e) {
            return null;
        }
        return null;
    }
}
