/**
 * AnimeWitcher — Nuvio Provider
 * Converted from Cloudstream Kotlin plugin (Abodabodd/re-3arabi)
 *
 * Architecture:
 *   TMDB ID → TMDB API (get title) → Algolia search → Firestore episodes → Firestore servers → resolve URLs
 */
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => { try { step(generator.next(value)); } catch (e) { reject(e); } };
    var rejected = (value) => { try { step(generator.throw(value)); } catch (e) { reject(e); } };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

// ── Constants ──────────────────────────────────────────────────────────
var TMDB_KEY = "439c478a771f35c05022f9feabcca01c";
var TMDB_BASE = "https://api.themoviedb.org/3";
var FIREBASE_PROJECT = "animewitcher-1c66d";
var FIRESTORE_BASE = "https://firestore.googleapis.com/v1/projects/" + FIREBASE_PROJECT + "/databases/(default)/documents";

var DEFAULT_ALGOLIA_APP_ID = "5UIU27G8CZ";
var DEFAULT_ALGOLIA_API_KEY = "ef06c5ee4a0d213c011694f18861805c";

var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
var FETCH_TIMEOUT = 15000;

var algoliaAppId = DEFAULT_ALGOLIA_APP_ID;
var algoliaApiKey = DEFAULT_ALGOLIA_API_KEY;
var serverWordsCache = {};

// ── Utility ────────────────────────────────────────────────────────────
function safeFetch(url, opts, ms) {
  ms = ms || FETCH_TIMEOUT;
  var controller, tid;
  try { controller = new AbortController(); tid = setTimeout(function () { controller.abort(); }, ms); } catch (e) { controller = null; }
  var o = Object.assign({ method: "GET" }, opts || {});
  if (!o.headers) o.headers = {};
  if (!o.headers["User-Agent"]) o.headers["User-Agent"] = UA;
  if (controller) o.signal = controller.signal;
  return fetch(url, o).then(function (r) { if (tid) clearTimeout(tid); return r; })
    .catch(function (e) { if (tid) clearTimeout(tid); throw e; });
}

function fetchJson(url, opts, ms) {
  return __async(this, null, function* () {
    try {
      var resp = yield safeFetch(url, opts, ms);
      if (!resp.ok) return null;
      return yield resp.json();
    } catch (e) {
      console.log("[AnimeWitcher] fetchJson error: " + e.message);
      return null;
    }
  });
}

function fetchText(url, opts, ms) {
  return __async(this, null, function* () {
    try {
      var resp = yield safeFetch(url, opts, ms);
      if (!resp.ok) return "";
      return yield resp.text();
    } catch (e) {
      console.log("[AnimeWitcher] fetchText error: " + e.message);
      return "";
    }
  });
}

// ── TMDB ───────────────────────────────────────────────────────────────
function getTmdbTitles(tmdbId, mediaType) {
  return __async(this, null, function* () {
    var type = mediaType === "movie" ? "movie" : "tv";
    var results = yield Promise.all([
      fetchJson(TMDB_BASE + "/" + type + "/" + tmdbId + "?api_key=" + TMDB_KEY + "&language=ar-SA"),
      fetchJson(TMDB_BASE + "/" + type + "/" + tmdbId + "?api_key=" + TMDB_KEY + "&language=en-US"),
      fetchJson(TMDB_BASE + "/" + type + "/" + tmdbId + "?api_key=" + TMDB_KEY + "&language=ja-JP")
    ]);
    var ar = results[0] || {};
    var en = results[1] || {};
    var ja = results[2] || {};
    var titles = [];
    var seen = {};
    function add(t) { if (t && !seen[t.toLowerCase()]) { seen[t.toLowerCase()] = true; titles.push(t); } }
    add(en.name || en.title);
    add(en.original_name || en.original_title);
    add(ar.name || ar.title);
    add(ja.name || ja.title);
    return titles;
  });
}

// ── Algolia ────────────────────────────────────────────────────────────
function refreshAlgoliaKeys() {
  return __async(this, null, function* () {
    try {
      var url = FIRESTORE_BASE + "/Settings";
      var data = yield fetchJson(url);
      if (!data || !data.documents) return;
      for (var i = 0; i < data.documents.length; i++) {
        var fields = data.documents[i].fields;
        if (fields && fields.search_settings) {
          var ss = fields.search_settings;
          if (ss.mapValue && ss.mapValue.fields) {
            var sf = ss.mapValue.fields;
            var newId = sf.app_id_v3 && sf.app_id_v3.stringValue;
            var newKey = sf.api_key && sf.api_key.stringValue;
            if (newId && newKey) {
              algoliaAppId = newId;
              algoliaApiKey = newKey;
              console.log("[AnimeWitcher] Algolia keys updated: " + algoliaAppId);
              return;
            }
          }
        }
      }
    } catch (e) {
      console.log("[AnimeWitcher] Failed to refresh Algolia keys: " + e.message);
    }
  });
}

function algoliaSearch(query) {
  return __async(this, null, function* () {
    var url = "https://" + algoliaAppId + "-dsn.algolia.net/1/indexes/series/query";
    var params = 'attributesToRetrieve=["objectID","name","poster_uri","type","english_title"]&hitsPerPage=20&page=0&query=' + encodeURIComponent(query);
    var body = JSON.stringify({ params: params });
    var resp = yield fetchJson(url, {
      method: "POST",
      headers: {
        "X-Algolia-Application-Id": algoliaAppId,
        "X-Algolia-API-Key": algoliaApiKey,
        "Content-Type": "application/json; charset=UTF-8"
      },
      body: body
    });
    if (!resp || !resp.hits) return [];
    return resp.hits;
  });
}

// ── Title matching ─────────────────────────────────────────────────────
function normalize(s) {
  return (s || "").toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}

function titleScore(a, b) {
  var na = normalize(a);
  var nb = normalize(b);
  if (na === nb) return 100;
  var wa = na.split(" ").filter(Boolean);
  var wb = nb.split(" ").filter(Boolean);
  if (wa.length === 0 || wb.length === 0) return 0;
  var hits = 0;
  for (var i = 0; i < wa.length; i++) {
    for (var j = 0; j < wb.length; j++) {
      if (wa[i] === wb[j]) { hits++; break; }
    }
  }
  return Math.round((hits / Math.max(wa.length, wb.length)) * 100);
}

function findBestMatch(hits, searchTitles) {
  var best = null;
  var bestScore = 0;
  for (var i = 0; i < hits.length; i++) {
    var hit = hits[i];
    var hitName = hit.name || "";
    var hitEn = hit.english_title || "";
    for (var j = 0; j < searchTitles.length; j++) {
      var s1 = titleScore(searchTitles[j], hitName);
      var s2 = titleScore(searchTitles[j], hitEn);
      var s = Math.max(s1, s2);
      if (s > bestScore) { bestScore = s; best = hit; }
    }
  }
  if (bestScore < 40) return null;
  console.log("[AnimeWitcher] Best match: " + (best ? best.name : "none") + " (score: " + bestScore + ")");
  return best;
}

// ── Firestore episode & server fetching ────────────────────────────────
function fetchEpisodes(animeId) {
  return __async(this, null, function* () {
    var list = [];
    var nextPage = null;
    try {
      do {
        var url = FIRESTORE_BASE + "/anime_list/" + encodeURIComponent(animeId) + "/episodes?pageSize=300";
        if (nextPage) url += "&pageToken=" + nextPage;
        var data = yield fetchJson(url, null, 20000);
        if (!data || !data.documents) break;
        for (var i = 0; i < data.documents.length; i++) {
          var doc = data.documents[i];
          var docId = doc.name.split("/").pop();
          var f = doc.fields || {};
          var epName = f.name && f.name.stringValue ? f.name.stringValue : null;
          var number = f.number && f.number.integerValue ? parseInt(f.number.integerValue) : (list.length + 1);
          list.push({ id: docId, name: epName, number: number });
        }
        nextPage = data.nextPageToken || null;
      } while (nextPage);
      list.sort(function (a, b) { return a.number - b.number; });
    } catch (e) {
      console.log("[AnimeWitcher] fetchEpisodes error: " + e.message);
    }
    return list;
  });
}

function fetchServers(animeId, episodeId) {
  return __async(this, null, function* () {
    var servers = [];
    // Try servers2/all_servers first
    try {
      var url = FIRESTORE_BASE + "/anime_list/" + encodeURIComponent(animeId) + "/episodes/" + encodeURIComponent(episodeId) + "/servers2/all_servers";
      var data = yield fetchJson(url, null, 10000);
      if (data && data.fields && data.fields.servers) {
        var arr = data.fields.servers.arrayValue && data.fields.servers.arrayValue.values;
        if (arr && arr.length > 0) {
          for (var i = 0; i < arr.length; i++) {
            var m = arr[i].mapValue.fields;
            var name = m.name && m.name.stringValue;
            var link = m.link && m.link.stringValue;
            var quality = m.quality && m.quality.stringValue;
            var orig = m.original_link && m.original_link.stringValue;
            if (name && link) servers.push({ name: name, link: link, quality: quality || "", originalLink: orig || "" });
          }
          if (servers.length > 0) return servers;
        }
      }
    } catch (e) { /* fallback to servers collection */ }

    // Fallback: servers collection
    try {
      var url2 = FIRESTORE_BASE + "/anime_list/" + encodeURIComponent(animeId) + "/episodes/" + encodeURIComponent(episodeId) + "/servers";
      var data2 = yield fetchJson(url2, null, 10000);
      if (data2 && data2.documents) {
        for (var i = 0; i < data2.documents.length; i++) {
          var f = data2.documents[i].fields || {};
          var name = f.name && f.name.stringValue;
          var link = f.link && f.link.stringValue;
          var quality = f.quality && f.quality.stringValue;
          var orig = f.original_link && f.original_link.stringValue;
          var visible = f.visible ? f.visible.booleanValue : true;
          if (name && link && visible !== false) servers.push({ name: name, link: link, quality: quality || "", originalLink: orig || "" });
        }
      }
    } catch (e) {
      console.log("[AnimeWitcher] fetchServers error: " + e.message);
    }
    return servers;
  });
}

// ── Server words (used for URL resolution) ─────────────────────────────
function getServerWords(serverName) {
  return __async(this, null, function* () {
    if (serverWordsCache[serverName]) return serverWordsCache[serverName];
    try {
      var url = FIRESTORE_BASE + "/Settings/servers/servers/" + encodeURIComponent(serverName);
      var data = yield fetchJson(url);
      if (!data || !data.fields) return null;
      var f = data.fields;
      var sw = {
        name: serverName,
        word1: f.word1 && f.word1.stringValue || null,
        word2: f.word2 && f.word2.stringValue || null,
        word3: f.word3 && f.word3.stringValue || null,
        word4: f.word4 && f.word4.stringValue || null
      };
      serverWordsCache[serverName] = sw;
      return sw;
    } catch (e) { return null; }
  });
}

// ── Server URL resolution ──────────────────────────────────────────────
function resolveServerUrl(server) {
  return __async(this, null, function* () {
    var name = (server.name || "").toUpperCase();
    var link = server.link;
    if (!link) return null;

    try {
      // Direct servers
      if (name === "MF" || name === "ST" || name === "MG") return link;

      // QI server — use original link
      if (name === "QI") return server.originalLink || link;

      // PD (Pixeldrain) — extract direct URL
      if (name === "PD") {
        var html = yield fetchText(link);
        if (!html) return link;
        // Try og:video meta
        var ogMatch = html.match(/<meta\s+property="og:video"\s+content="([^"]+)"/);
        if (ogMatch) return ogMatch[1].replace(/&amp;/g, "&");
        // Try pixeldrain download link
        var pdMatch = html.match(/https?:\/\/pixeldrain\.com\/u\/[A-Za-z0-9_-]+/);
        if (pdMatch) return pdMatch[0];
        return link;
      }

      // AR server — follow redirect
      if (name === "AR") {
        try {
          var resp = yield safeFetch(link, { redirect: "follow" }, 8000);
          return resp.url || link;
        } catch (e) { return null; }
      }

      // WC server — get Location header
      if (name === "WC") {
        try {
          var resp = yield safeFetch(link, { redirect: "manual" }, 8000);
          return resp.headers.get("location") || null;
        } catch (e) { return null; }
      }

      // KF, VT, and generic word-based resolution
      var words = yield getServerWords(server.name);
      if (!words || !words.word1 || !words.word2) return null;

      if (name === "KF") {
        var res = yield fetchText(link);
        if (!res) return null;
        var part = res.split(words.word1)[1];
        if (!part) return null;
        return "https://" + part.split(words.word2)[0].replace(/amp;/g, "");
      }

      if (name === "VT") {
        if (!words.word3 || !words.word4) return null;
        var res1 = yield fetchText(link);
        if (!res1) return null;
        var p1 = res1.split(words.word1)[1];
        if (!p1) return null;
        var newLink = "https://vidtube.one" + p1.split(words.word2)[0].replace(/\">/g, "").trim();
        var res2 = yield fetchText(newLink);
        if (!res2) return null;
        var p2 = res2.split(words.word3)[1];
        if (!p2) return null;
        return "https://" + p2.split(words.word4)[0];
      }

      // Generic word-based
      var res = yield fetchText(link);
      if (!res) return null;
      var segment = res.split(words.word1)[1];
      if (!segment) return null;
      return segment.split(words.word2)[0].replace(/amp;/g, "");

    } catch (e) {
      console.log("[AnimeWitcher] resolveServerUrl error for " + name + ": " + e.message);
      return null;
    }
  });
}

function qualityToInt(q) {
  if (!q) return 0;
  var n = q.replace(/[^\d]/g, "");
  return parseInt(n) || 0;
}

function normalizeQuality(q) {
  if (!q) return "Unknown";
  var n = qualityToInt(q);
  if (n >= 2160) return "4K";
  if (n >= 1080) return "1080p";
  if (n >= 720) return "720p";
  if (n >= 480) return "480p";
  if (n >= 360) return "360p";
  return q || "Unknown";
}

// ── Main entry point ───────────────────────────────────────────────────
function getStreams(tmdbId, mediaType, season, episode) {
  return __async(this, null, function* () {
    try {
      var t0 = Date.now();
      var isTV = mediaType !== "movie";
      var seasonNum = isTV ? parseInt(season) || 1 : 1;
      var episodeNum = isTV ? parseInt(episode) || 1 : 1;
      console.log("[AnimeWitcher] Request: " + mediaType + " " + tmdbId + (isTV ? " S" + seasonNum + "E" + episodeNum : ""));

      // Step 1: Get TMDB titles
      var titles = yield getTmdbTitles(tmdbId, mediaType);
      if (!titles || titles.length === 0) {
        console.log("[AnimeWitcher] No titles from TMDB");
        return [];
      }
      console.log("[AnimeWitcher] TMDB titles: " + titles.join(", "));

      // Step 2: Refresh Algolia keys and search
      yield refreshAlgoliaKeys();

      var allHits = [];
      for (var i = 0; i < titles.length; i++) {
        var hits = yield algoliaSearch(titles[i]);
        if (hits.length > 0) allHits = allHits.concat(hits);
        if (allHits.length >= 20) break;
      }

      if (allHits.length === 0) {
        console.log("[AnimeWitcher] No Algolia results");
        return [];
      }

      // Step 3: Find best match
      var match = findBestMatch(allHits, titles);
      if (!match) {
        console.log("[AnimeWitcher] No match above threshold");
        return [];
      }
      var animeId = match.objectID;
      console.log("[AnimeWitcher] Matched: " + match.name + " (ID: " + animeId + ")");

      // Step 4: Fetch episodes
      var episodes = yield fetchEpisodes(animeId);
      console.log("[AnimeWitcher] Episodes: " + episodes.length);
      if (episodes.length === 0) return [];

      // Step 5: Find the target episode
      var targetEp = null;
      for (var i = 0; i < episodes.length; i++) {
        if (episodes[i].number === episodeNum) { targetEp = episodes[i]; break; }
      }
      if (!targetEp) {
        console.log("[AnimeWitcher] Episode " + episodeNum + " not found");
        return [];
      }

      // Step 6: Fetch servers for this episode
      var servers = yield fetchServers(animeId, targetEp.id);
      console.log("[AnimeWitcher] Servers: " + servers.length);
      if (servers.length === 0) return [];

      // Sort by quality descending
      servers.sort(function (a, b) { return qualityToInt(b.quality) - qualityToInt(a.quality); });

      // Step 7: Resolve server URLs in parallel
      var resolvePromises = servers.map(function (srv) {
        return resolveServerUrl(srv).then(function (url) {
          if (url) return { server: srv, url: url };
          return null;
        }).catch(function () { return null; });
      });
      var resolved = yield Promise.all(resolvePromises);

      // Step 8: Build stream objects
      var streams = [];
      for (var i = 0; i < resolved.length; i++) {
        if (!resolved[i]) continue;
        var srv = resolved[i].server;
        var url = resolved[i].url;
        if (!url || url.trim().startsWith("<")) continue;

        var quality = normalizeQuality(srv.quality);
        streams.push({
          name: "AnimeWitcher " + (srv.name || "Server") + " " + quality,
          title: quality + " [" + (srv.name || "Server") + "]",
          url: url,
          quality: quality,
          size: "",
          headers: {},
          subtitles: [],
          provider: "animewitcher"
        });
      }

      console.log("[AnimeWitcher] === Done: " + streams.length + " streams in " + (Date.now() - t0) + "ms ===");
      return streams;
    } catch (error) {
      console.error("[AnimeWitcher] Error: " + error.message);
      return [];
    }
  });
}

module.exports = { getStreams };
