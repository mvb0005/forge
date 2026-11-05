// Stands in for the cluster's router (deploy/k8s/router.conf) on one machine: the tracker and one game server
// behind one origin, so the replay page fetches its file and "play from here" from the tracker as it does live.
// usage: node tools/router.mjs [--port 7802] [--tracker 127.0.0.1:7801] [--table 127.0.0.1:7977]
//   /play/table/<id>/replay/...  the game server's UI (the router's viewer), with the prefix stripped
//   /play/table/<id>/...         the game server (sockets too)
//   anything else                the tracker
// Run the tracker with FORGE_TABLE_URL=http://127.0.0.1:<port>/play/table/ so its table links come here.
import { request, createServer } from "node:http";
import { connect } from "node:net";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt;
};
const port = Number(opt("port", 7802));
const hostPort = (s) => ({ host: s.split(":")[0], port: Number(s.split(":")[1]) });
const tracker = hostPort(opt("tracker", "127.0.0.1:7801"));
const table = hostPort(opt("table", "127.0.0.1:7977"));

function route(url) {
  const replay = /^\/play\/table\/[0-9a-f]{16}\/replay(\/.*)$/.exec(url);
  if (replay) return { ...table, path: replay[1] };
  if (/^\/play\/table\/[0-9a-f]{16}(\/|$)/.test(url)) return { ...table, path: url };
  return { ...tracker, path: url };
}

const server = createServer((req, res) => {
  if (/^\/play\/table\/[0-9a-f]{16}\/replay(\?|$)/.test(req.url)) {
    res.writeHead(302, { location: req.url.replace(/replay/, "replay/") }).end();
    return;
  }
  const to = route(req.url);
  const up = request({ host: to.host, port: to.port, path: to.path, method: req.method, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  up.on("error", (e) => res.writeHead(502).end(String(e)));
  req.pipe(up);
});
server.on("upgrade", (req, socket, head) => {
  const to = route(req.url);
  const up = connect(to.port, to.host, () => {
    up.write(`${req.method} ${to.path} HTTP/1.1\r\n${Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join("\r\n")}\r\n\r\n`);
    up.write(head);
    socket.pipe(up).pipe(socket);
  });
  up.on("error", () => socket.destroy());
  socket.on("error", () => up.destroy());
});
server.listen(port, "127.0.0.1", () => console.log(`router on http://127.0.0.1:${port}/ (tracker ${tracker.host}:${tracker.port}, table ${table.host}:${table.port})`));
