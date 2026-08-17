# Federated Wiki - Table Plugin

This plugin, type: `table`, extends the markup of the federated wiki with a
first-class table item: type CSV, TSV, a markdown pipe table or JSON into the
item and it renders as a compact grid (narrow data) or stacked row cards (wide
data), enlarges to a sortable grid over the page, exposes its data to other
plugins in the lineup, and answers over REST and MCP.

## Provenance

Cloned from Ward Cunningham's
[wiki-plugin-json](https://github.com/WardCunningham/wiki-plugin-json)
v0.1.10 (commit dc1a75d, 2018) and ported from CoffeeScript/grunt to
JavaScript/esbuild. What survives from json: the item owns its data,
`GET`/`PUT /plugin/<name>/:slug` against the first such item on a page, the
`X-Api-Key` tokens file, the `writes/written/interval/writer` bookkeeping and
the stats line. See AUTHORS.txt.

## Layout

    src/parse/parse.cjs   the one parser (client bundle + server share it)
    src/client/table.js   emit/bind, layouts, enlarged overlay, data interface
    client/table.css      styles, injected once by emit
    server/server.js      json-parity routes: GET/PUT /plugin/table/:slug (CommonJS)
    server/core.js        read/write path shared by server.js and api/handlers.js
    server/bridge.js      per-site pagehandler handed from server.js to the farm handlers
    api/openapi.json      the fedwiki.api declaration wiki-plugin-farm mounts
    api/handlers.js       read, list, csv, write
    pages/                About Table Plugin, About Table API Keys

## Build

    npm install
    npm run build
    npm test

## REST and MCP

Declared operations are mounted by
[wiki-plugin-farm](https://github.com/Hitchhikers-Guide-to-the-Galaxy/wiki-plugin-farm)
under `/system/api/table/{read,list,csv,write}.json`, described in
`/system/api.json`, and offered as MCP tools at `POST /system/api/mcp`.
The plugin's own server answers `GET /plugin/table/:slug` (`.csv` for text/csv)
and an api-key `PUT` for headless writers.

## License

MIT
