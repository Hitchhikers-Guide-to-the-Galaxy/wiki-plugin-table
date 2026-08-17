// bridge.js — one place the plugin's own server leaves the wiki's page handler
// for the farm-mounted handlers to find. CommonJS singleton: server/server.js
// (loaded by wiki-server) and api/handlers.js (loaded by wiki-plugin-farm)
// both require() this file, so through Node's require cache they share the
// same object. Keyed by site, since a farm starts one express app per site.
//
// When empty (the farm's offline generator, tests), readers fall back to the
// page file on disk and writers refuse — nothing here pretends to persist.

const handlers = new Map() // origin -> app.pagehandler

module.exports = {
  set: (origin, pagehandler) => handlers.set(String(origin || '').toLowerCase(), pagehandler),
  get: origin => handlers.get(String(origin || '').toLowerCase()) || null,
  size: () => handlers.size,
}
