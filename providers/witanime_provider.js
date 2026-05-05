/**
 * WitAnime — Nuvio Provider
 * Converted from Cloudstream Kotlin plugin (Abodabodd/re-3arabi)
 *
 * Architecture:
 *   TMDB ID → TMDB API (get title) → witanime.red search → episode page → 
 *   decrypt _zG/_zH registries + px9 encryption → extract server URLs
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
var BASE_URL = "https://witanime.red";
var TMDB_KEY = "439c478a771f35c05022f9feabcca01c";
var TMDB_BASE = "https://api.themoviedb.org/3";
var UA = "Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.106 Mobile Safari/537.36";
var FETCH_TIMEOUT = 15000;

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

function fetchText(url, opts, ms) {
  return __async(this, null, function* () {
    try {
      var resp = yield safeFetch(url, opts, ms);
      if (!resp.ok) return "";
      return yield resp.text();
    } catch (e) { return ""; }
  });
}

function fetchJson(url, opts, ms) {
  return __async(this, null, function* () {
    try {
      var resp = yield safeFetch(url, opts, ms);
      if (!resp.ok) return null;
      return yield resp.json();
    } catch (e) { return null; }
  });
}

// ── Base64 / XOR utilities ─────────────────────────────────────────────
function b64Decode(s) {
  if (!s) return "";
  try {
    // Node.js / Nuvio runtime
    if (typeof Buffer !== "undefined") return Buffer.from(s, "base64").toString("utf-8");
    // Browser
    return atob(s);
  } catch (e) { return ""; }
}

function b64DecodeBytes(s) {
  if (!s) return [];
  try {
    if (typeof Buffer !== "undefined") {
      var buf = Buffer.from(s, "base64");
      var arr = [];
      for (var i = 0; i < buf.length; i++) arr.push(buf[i]);
      return arr;
    }
    var raw = atob(s);
    var arr = [];
    for (var i = 0; i < raw.length; i++) arr.push(raw.charCodeAt(i));
    return arr;
  } catch (e) { return []; }
}

function hexToBytes(hex) {
  if (!hex) return [];
  var cleaned = hex.replace(/[^0-9a-fA-F]/g, "");
  if (cleaned.length % 2 !== 0) return [];
  var bytes = [];
  for (var i = 0; i < cleaned.length; i += 2) {
    bytes.push(parseInt(cleaned.substr(i, 2), 16));
  }
  return bytes;
}

function xorWithKey(data, key) {
  if (!key || key.length === 0) return data;
  var out = [];
  for (var i = 0; i < data.length; i++) {
    out.push(data[i] ^ key[i % key.length]);
  }
  return out;
}

function bytesToString(bytes) {
  if (!bytes || bytes.length === 0) return "";
  var s = "";
  for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] & 0xFF);
  return s;
}

function safeTrim(s) {
  if (!s) return "";
  return s.replace(/[\x00\u0000]/g, "").trim();
}

function cleanBase64Chars(s) {
  return (s || "").replace(/[^A-Za-z0-9+/=]/g, "");
}

// ── TMDB ───────────────────────────────────────────────────────────────
function getTmdbInfo(tmdbId, mediaType) {
  return __async(this, null, function* () {
    var type = mediaType === "movie" ? "movie" : "tv";
    var results = yield Promise.all([
      fetchJson(TMDB_BASE + "/" + type + "/" + tmdbId + "?api_key=" + TMDB_KEY + "&language=ar-SA"),
      fetchJson(TMDB_BASE + "/" + type + "/" + tmdbId + "?api_key=" + TMDB_KEY + "&language=en-US")
    ]);
    var ar = results[0] || {};
    var en = results[1] || {};
    var titles = [];
    var seen = {};
    function add(t) { if (t && !seen[t.toLowerCase()]) { seen[t.toLowerCase()] = true; titles.push(t); } }
    add(ar.name || ar.title);
    add(en.name || en.title);
    add(en.original_name || en.original_title);
    return { titles: titles, year: en.first_air_date ? en.first_air_date.split("-")[0] : (en.release_date ? en.release_date.split("-")[0] : "") };
  });
}

// ── Site search and episode discovery ──────────────────────────────────
function searchWitAnime(query) {
  return __async(this, null, function* () {
    var url = BASE_URL + "/?search_param=animes&s=" + encodeURIComponent(query);
    var html = yield fetchText(url);
    if (!html) return [];
    var results = [];
    // Parse anime cards from search results
    var cardRegex = /<div class="anime-card-container">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;
    var match;
    while ((match = cardRegex.exec(html)) !== null) {
      var card = match[1];
      var hrefMatch = card.match(/<a[^>]+href="([^"]+)"/);
      var titleMatch = card.match(/<h3[^>]*><a[^>]*>([^<]+)<\/a>/);
      if (hrefMatch && titleMatch) {
        results.push({ url: hrefMatch[1], title: titleMatch[1].trim() });
      }
    }
    // Fallback: broader regex
    if (results.length === 0) {
      var linkRegex = /<a[^>]+class="overlay"[^>]+href="([^"]+)"/g;
      var m;
      while ((m = linkRegex.exec(html)) !== null) {
        var titleM = html.substring(m.index, m.index + 500).match(/<h3[^>]*><a[^>]*>([^<]+)<\/a>/);
        results.push({ url: m[1], title: titleM ? titleM[1].trim() : "" });
      }
    }
    return results;
  });
}

function normalize(s) {
  return (s || "").toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}

function scoreTitles(a, b) {
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

function findEpisodePage(showUrl, episodeNum) {
  return __async(this, null, function* () {
    var html = yield fetchText(showUrl);
    if (!html) return null;

    // Try processedEpisodeData (encrypted episode list)
    var dataMatch = html.match(/var\s+processedEpisodeData\s*=\s*'([^']+)'/);
    if (dataMatch) {
      try {
        var parts = dataMatch[1].split(".");
        if (parts.length === 2) {
          var p1 = b64Decode(parts[0]);
          var p2 = b64Decode(parts[1]);
          var decoded = "";
          for (var i = 0; i < p1.length; i++) {
            decoded += String.fromCharCode(p1.charCodeAt(i) ^ p2.charCodeAt(i % p2.length));
          }
          var episodes = JSON.parse(decoded);
          if (Array.isArray(episodes)) {
            for (var i = 0; i < episodes.length; i++) {
              var ep = episodes[i];
              var epNum = parseInt(ep.number) || parseInt(ep.title) || (i + 1);
              if (epNum === episodeNum && ep.url) return ep.url;
            }
          }
        }
      } catch (e) {
        console.log("[WitAnime] processedEpisodeData decode error: " + e.message);
      }
    }

    // Fallback: parse episode links from HTML
    var epRegex = /href="([^"]*episode[^"]*)"/gi;
    var epMatch;
    var epUrls = [];
    while ((epMatch = epRegex.exec(html)) !== null) {
      epUrls.push(epMatch[1]);
    }
    // Match by episode number in URL
    for (var i = 0; i < epUrls.length; i++) {
      var numMatch = epUrls[i].match(/(\d+)/g);
      if (numMatch) {
        var lastNum = parseInt(numMatch[numMatch.length - 1]);
        if (lastNum === episodeNum) return epUrls[i];
      }
    }
    return epUrls.length > 0 ? epUrls[Math.min(episodeNum - 1, epUrls.length - 1)] : null;
  });
}

// ── Stream decryption (x18c + px9 frameworks from WitAnime) ────────────
function decodeX18cResource(resourceRaw, paramOffset) {
  var raw = null;
  if (typeof resourceRaw === "string") raw = resourceRaw;
  else if (resourceRaw && typeof resourceRaw === "object") {
    raw = resourceRaw.r || resourceRaw.resource || resourceRaw.data || null;
  }
  if (!raw) return "";
  var rev = raw.split("").reverse().join("");
  var cleaned = cleanBase64Chars(rev);
  var decoded = b64DecodeBytes(cleaned);
  var slice = (paramOffset > 0 && paramOffset <= decoded.length) ? decoded.slice(0, decoded.length - paramOffset) : decoded;
  return safeTrim(bytesToString(slice));
}

function getParamOffset(config) {
  if (!config) return 0;
  try {
    var k = config.k;
    if (!k) return 0;
    var idx = parseInt(b64Decode(k));
    if (isNaN(idx)) return 0;
    var d = config.d;
    if (Array.isArray(d) && idx < d.length) return d[idx] || 0;
  } catch (e) { }
  return 0;
}

function parsePx9(js) {
  var mMatch = js.match(/var\s+_m\s*=\s*\{\s*\"r\"\s*:\s*\"([^\"]+)\"/);
  var mVal = mMatch ? mMatch[1] : null;

  var sMatch = js.match(/var\s+_s\s*=\s*\[(.*?)\]\s*;/s);
  var sList = [];
  if (sMatch) {
    var items = sMatch[1].match(/\"([^\"]*)\"/g);
    if (items) sList = items.map(function (i) { return i.replace(/"/g, ""); });
  }

  var pMap = {};
  var pRegex = /var\s+(_p\d+)\s*=\s*\[\s*(.*?)\s*\]\s*;/gs;
  var pm;
  while ((pm = pRegex.exec(js)) !== null) {
    var key = pm[1];
    var items = pm[2].match(/\"([^\"]*)\"/g);
    if (items) pMap[key] = items.map(function (i) { return i.replace(/"/g, ""); });
  }
  return { mVal: mVal, sList: sList, pMap: pMap };
}

function processPxChunk(hex, secret) {
  var data = hexToBytes(hex);
  if (data.length === 0) return "";
  var xored = xorWithKey(data, secret);
  return safeTrim(bytesToString(xored));
}

function decryptPx9All(mrBase64, sList, pDict) {
  if (!mrBase64) return [];
  var secret = b64DecodeBytes(mrBase64);
  var results = [];
  var count = Math.max(sList.length, Object.keys(pDict).length);

  for (var i = 0; i < count; i++) {
    var key = "_p" + i;
    var chunks = pDict[key];
    if (!chunks) continue;

    var seq = null;
    if (i < sList.length) {
      try {
        var seqDecoded = processPxChunk(sList[i], secret);
        seq = JSON.parse(seqDecoded);
      } catch (e) { seq = null; }
    }

    var decrypted = chunks.map(function (ch) { return processPxChunk(ch, secret); });

    var final;
    if (seq && Array.isArray(seq) && seq.length === decrypted.length) {
      var arr = new Array(decrypted.length).fill("");
      for (var j = 0; j < decrypted.length; j++) {
        var pos = seq[j];
        if (pos >= 0 && pos < arr.length) arr[pos] = decrypted[j];
      }
      final = arr.join("");
    } else {
      final = decrypted.join("");
    }
    results.push(safeTrim(final));
  }
  return results;
}

function extractStreamsFromEpisodePage(episodeUrl) {
  return __async(this, null, function* () {
    var html = yield fetchText(episodeUrl);
    if (!html) return [];

    var streams = [];

    // ── Phase 1: x18c registry decryption ──
    var zGMatch = html.match(/var\s+_zG\s*=\s*\"([^\"]+)\"/);
    var zHMatch = html.match(/var\s+_zH\s*=\s*\"([^\"]+)\"/);

    // Try external scripts if not found inline
    if (!zGMatch || !zHMatch) {
      var scriptSrcs = [];
      var srcRegex = /<script[^>]+src=[\"']([^\"']+)[\"'][^>]*>/gi;
      var sm;
      while ((sm = srcRegex.exec(html)) !== null) {
        var src = sm[1];
        if (src.startsWith("http")) scriptSrcs.push(src);
        else {
          try { scriptSrcs.push(new URL(src, episodeUrl).toString()); } catch (e) { scriptSrcs.push(src); }
        }
      }
      for (var i = 0; i < scriptSrcs.length; i++) {
        var js = yield fetchText(scriptSrcs[i]);
        if (!zGMatch) { var m = js.match(/var\s+_zG\s*=\s*\"([^\"]+)\"/); if (m) zGMatch = m; }
        if (!zHMatch) { var m = js.match(/var\s+_zH\s*=\s*\"([^\"]+)\"/); if (m) zHMatch = m; }
        if (zGMatch && zHMatch) break;
      }
    }

    if (zGMatch && zHMatch) {
      try {
        var resourceRegistry = JSON.parse(b64Decode(zGMatch[1]));
        var configRegistry = JSON.parse(b64Decode(zHMatch[1]));

        // Find server elements
        var serverRegex = /data-server-id\s*=\s*[\"']([^\"']+)[\"']/g;
        var svr;
        while ((svr = serverRegex.exec(html)) !== null) {
          var sid = svr[1];
          var resource = resourceRegistry[sid] || resourceRegistry[parseInt(sid)];
          var config = configRegistry[sid] || configRegistry[parseInt(sid)];
          if (!resource) continue;
          var offset = getParamOffset(config);
          var link = decodeX18cResource(resource, offset);
          if (link && link.startsWith("http")) {
            streams.push(link);
          }
        }
      } catch (e) {
        console.log("[WitAnime] x18c decode error: " + e.message);
      }
    }

    // ── Phase 2: px9 encryption ──
    var px9 = { mVal: null, sList: [], pMap: {} };

    // Try inline scripts
    var scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/g;
    var scriptMatch;
    while ((scriptMatch = scriptRegex.exec(html)) !== null) {
      var s = scriptMatch[1];
      if (s.indexOf("_m") > -1 && s.indexOf("_p0") > -1) {
        px9 = parsePx9(s);
        if (px9.mVal && Object.keys(px9.pMap).length > 0) break;
      }
    }

    // Try external scripts if not found
    if (!px9.mVal || Object.keys(px9.pMap).length === 0) {
      var extScripts = [];
      var esRegex = /<script[^>]+src=[\"']([^\"']+)[\"'][^>]*>/gi;
      var esm;
      while ((esm = esRegex.exec(html)) !== null) {
        var src = esm[1];
        if (src.startsWith("http")) extScripts.push(src);
        else { try { extScripts.push(new URL(src, episodeUrl).toString()); } catch (e) { } }
      }
      for (var i = 0; i < extScripts.length; i++) {
        var js = yield fetchText(extScripts[i]);
        if (!js) continue;
        var parsed = parsePx9(js);
        if (parsed.mVal) px9.mVal = parsed.mVal;
        if (parsed.sList.length > 0) px9.sList = parsed.sList;
        if (Object.keys(parsed.pMap).length > 0) Object.assign(px9.pMap, parsed.pMap);
        if (px9.mVal && Object.keys(px9.pMap).length > 0) break;
      }
    }

    var downloadLinks = decryptPx9All(px9.mVal, px9.sList, px9.pMap);
    for (var i = 0; i < downloadLinks.length; i++) {
      var dl = downloadLinks[i];
      if (dl) {
        var httpIdx = dl.indexOf("http");
        if (httpIdx >= 0) {
          var cleaned = safeTrim(dl.substring(httpIdx));
          if (cleaned.startsWith("http")) streams.push(cleaned);
        }
      }
    }

    return streams;
  });
}

// ── Determine if URL is a direct video stream ─────────────────────────
function isDirectStream(url) {
  if (!url) return false;
  var lower = url.toLowerCase();
  return lower.indexOf(".mp4") > -1 || lower.indexOf(".m3u8") > -1 || lower.indexOf(".mkv") > -1 ||
    lower.indexOf("download") > -1 || lower.indexOf("stream") > -1;
}

function resolveStreamUrl(url) {
  return __async(this, null, function* () {
    if (isDirectStream(url)) return url;

    // Try to extract from embed pages
    try {
      var html = yield fetchText(url, null, 8000);
      if (!html) return url;

      // Look for direct video URLs in HTML
      var m3u8 = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/);
      if (m3u8) return m3u8[0];

      var mp4 = html.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/);
      if (mp4) return mp4[0];

      // Look for source tags
      var srcMatch = html.match(/<source[^>]+src="([^"]+)"/);
      if (srcMatch) return srcMatch[1];

      // Look for file/src in JS
      var fileMatch = html.match(/(?:file|src)\s*:\s*"(https?:\/\/[^"]+)"/);
      if (fileMatch) return fileMatch[1];

      return url;
    } catch (e) {
      return url;
    }
  });
}

// ── Main entry point ───────────────────────────────────────────────────
function getStreams(tmdbId, mediaType, season, episode) {
  return __async(this, null, function* () {
    try {
      var t0 = Date.now();
      var isTV = mediaType !== "movie";
      var episodeNum = isTV ? parseInt(episode) || 1 : 1;
      console.log("[WitAnime] Request: " + mediaType + " " + tmdbId + (isTV ? " S" + (season || 1) + "E" + episodeNum : ""));

      // Step 1: Get TMDB info
      var info = yield getTmdbInfo(tmdbId, mediaType);
      if (!info.titles || info.titles.length === 0) {
        console.log("[WitAnime] No titles from TMDB");
        return [];
      }
      console.log("[WitAnime] TMDB titles: " + info.titles.join(", "));

      // Step 2: Search WitAnime
      var allResults = [];
      for (var i = 0; i < info.titles.length; i++) {
        var results = yield searchWitAnime(info.titles[i]);
        allResults = allResults.concat(results);
        if (allResults.length >= 15) break;
      }

      if (allResults.length === 0) {
        console.log("[WitAnime] No search results");
        return [];
      }

      // Step 3: Find best match
      var bestResult = null;
      var bestScore = 0;
      for (var i = 0; i < allResults.length; i++) {
        for (var j = 0; j < info.titles.length; j++) {
          var s = scoreTitles(info.titles[j], allResults[i].title);
          if (s > bestScore) { bestScore = s; bestResult = allResults[i]; }
        }
      }
      if (!bestResult || bestScore < 40) {
        console.log("[WitAnime] No match above threshold (best: " + bestScore + ")");
        // Fallback: use first result
        bestResult = allResults[0];
      }
      console.log("[WitAnime] Matched: " + bestResult.title + " (score: " + bestScore + ")");

      // Step 4: Find episode page
      var episodeUrl;
      if (isTV) {
        episodeUrl = yield findEpisodePage(bestResult.url, episodeNum);
      } else {
        episodeUrl = bestResult.url;
      }
      if (!episodeUrl) {
        console.log("[WitAnime] Episode page not found");
        return [];
      }
      console.log("[WitAnime] Episode URL: " + episodeUrl);

      // Step 5: Extract streams from episode page
      var rawUrls = yield extractStreamsFromEpisodePage(episodeUrl);
      console.log("[WitAnime] Raw URLs extracted: " + rawUrls.length);

      // Step 6: Resolve and build stream objects
      var streams = [];
      var seen = {};
      var resolvePromises = rawUrls.map(function (url) {
        return resolveStreamUrl(url).then(function (resolved) {
          return { original: url, resolved: resolved };
        }).catch(function () { return null; });
      });
      var resolved = yield Promise.all(resolvePromises);

      for (var i = 0; i < resolved.length; i++) {
        if (!resolved[i]) continue;
        var url = resolved[i].resolved;
        if (!url || seen[url]) continue;
        seen[url] = true;

        var quality = "Unknown";
        if (url.indexOf("1080") > -1) quality = "1080p";
        else if (url.indexOf("720") > -1) quality = "720p";
        else if (url.indexOf("480") > -1) quality = "480p";
        else if (url.indexOf("360") > -1) quality = "360p";

        var format = url.indexOf(".m3u8") > -1 ? "HLS" : "MP4";
        var serverName = "Server " + (i + 1);
        try {
          var host = url.match(/\/\/([^/]+)/);
          if (host) serverName = host[1].split(".").slice(-2).join(".");
        } catch (e) { }

        streams.push({
          name: "WitAnime " + serverName,
          title: quality + " [" + format + "]",
          url: url,
          quality: quality,
          size: "",
          headers: { "Referer": BASE_URL + "/" },
          subtitles: [],
          provider: "witanime"
        });
      }

      console.log("[WitAnime] === Done: " + streams.length + " streams in " + (Date.now() - t0) + "ms ===");
      return streams;
    } catch (error) {
      console.error("[WitAnime] Error: " + error.message);
      return [];
    }
  });
}

module.exports = { getStreams };
