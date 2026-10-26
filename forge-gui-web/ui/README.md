# Forge web UI

React 19, TypeScript and Vite. The server, the wire contract and how to run a match are in
[../README.md](../README.md). What to build is [../docs/PLAN.md](../docs/PLAN.md); how the table
should look is [../docs/DESIGN.md](../docs/DESIGN.md).

```
npm install
npm run dev      # http://127.0.0.1:5173, proxies /ws and /img to the server on port 7777
npm run build
npm test
npx tsc -p tsconfig.app.json --noEmit
```

Dev routes: `/?preview`, `/?bench=pod`, `/?look`, `/?dialogs`, `/?peek`. Preview and bench also
work from a production build; the others are dev-server only.
