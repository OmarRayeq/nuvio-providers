/**
 * Akwam — Nuvio Provider
 * Converted from Cloudstream Kotlin plugin (Abodabodd/re-3arabi)
 *
 * Architecture:
 *   TMDB ID → TMDB API (get title) → ak.sv search → detail page →
 *   watch page (link-show → watch URL → source[src] elements) → direct video URLs
 *
 * Content: Movies, TV Series, Asian Drama
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
var BASE_URL = "https://ak.sv";
var TMDB_KEY = "439c478a771f35c05022f9feabcca01c";
var TMDB_BASE = "https://api.themoviedb.org/3";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
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
    } catch (e) {
      console.log("[Akwam] fetchText error: " + e.message);
      return "";
    }
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

// ── HTML parsing utilities ─────────────────────────────────────────────
function extractAttr(html, selector, attr) {
  // Simple regex-based attribute extraction — supports basic CSS selectors
  var tag = selector.replace(/\./g, '[^>]*class="[^"]*').replace(/\[/g, '[^>]*').replace(/\]/g, '[^>]*');
  var regex = new RegExp('<[^>]*' + tag + '[^>]*' + attr + '="([^"]*)"', 'i');
  var match = html.match(regex);
  return match ? match[1] : null;
}

function extractAllMatches(html, regex) {
  var results = [];
  var m;
  while ((m = regex.exec(html)) !== null) {
    results.push(m);
  }
  return results;
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

    var year = "";
    var dateStr = en.first_air_date || en.release_date;
    if (dateStr) year = dateStr.split("-")[0];

    var totalSeasons = en.number_of_seasons || 1;

    return { titles: titles, year: year, isMovie: mediaType === "movie", totalSeasons: totalSeasons };
  });
}

// ── Akwam search ───────────────────────────────────────────────────────
function searchAkwam(query) {
  return __async(this, null, function* () {
    var url = BASE_URL + "/search?q=" + encodeURIComponent(query);
    var html = yield fetchText(url);
    if (!html) return [];

    var results = [];
    // Parse search result cards: div.col-lg-auto.col-md-4.col-6
    // Extract title from h3.entry-title a and href from first a tag
    var cardRegex = /<div[^>]*class="[^"]*col-lg-auto[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g;
    var m;
    while ((m = cardRegex.exec(html)) !== null) {
      var card = m[1];
      var titleMatch = card.match(/<h3[^>]*class="[^"]*entry-title[^"]*"[^>]*>\s*<a[^>]*>([^<]+)<\/a>/);
      var hrefMatch = card.match(/<a[^>]+href="([^"]+)"/);
      if (titleMatch && hrefMatch) {
        results.push({
          title: titleMatch[1].trim(),
          url: hrefMatch[1]
        });
      }
    }

    // Broader fallback
    if (results.length === 0) {
      var linkRegex = /<h3[^>]*entry-title[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
      var lm;
      while ((lm = linkRegex.exec(html)) !== null) {
        results.push({ url: lm[1], title: lm[2].trim() });
      }
    }

    return results;
  });
}

// ── Title matching ─────────────────────────────────────────────────────
function normalize(s) {
  return (s || "").toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}

function scoreTitles(a, b) {
  var na = normalize(a);
  var nb = normalize(b);
  if (na === nb) return 100;
  if (na.indexOf(nb) > -1 || nb.indexOf(na) > -1) return 85;
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

// ── Episode discovery ──────────────────────────────────────────────────
function findEpisodeUrl(showUrl, seasonNum, episodeNum) {
  return __async(this, null, function* () {
    var html = yield fetchText(showUrl, { headers: { "Referer": BASE_URL } });
    if (!html) return null;

    // Check if this is a movie (no episodes section)
    var hasEpisodes = html.indexOf("series-episodes") > -1 || html.indexOf("/episode/") > -1;
    if (!hasEpisodes) return showUrl; // Movie — use the detail page itself

    // Find season links
    var seasonUrls = [];
    var seasonRegex = /<a[^>]+class="[^"]*btn[^"]*"[^>]+href="([^"]*\/series\/[^"]*)"/gi;
    var sm;
    while ((sm = seasonRegex.exec(html)) !== null) {
      var href = sm[1];
      if (!href.startsWith("http")) href = BASE_URL + href;
      seasonUrls.push(href);
    }

    // Current page is one season, others are linked
    var pagesToCheck = [showUrl];
    for (var i = 0; i < seasonUrls.length; i++) {
      if (pagesToCheck.indexOf(seasonUrls[i]) < 0) pagesToCheck.push(seasonUrls[i]);
    }

    // Arabic season number mapping
    var arabicSeasonMap = {
      "الاول": 1, "الأول": 1, "الثاني": 2, "الثالث": 3, "الرابع": 4,
      "الخامس": 5, "السادس": 6, "السابع": 7, "الثامن": 8, "التاسع": 9, "العاشر": 10
    };

    // Determine which page corresponds to our season
    var targetPageUrl = showUrl;
    if (seasonNum > 1 && seasonUrls.length > 0) {
      // Try to find the season by number in URL text
      for (var i = 0; i < pagesToCheck.length; i++) {
        var pageHtml = i === 0 ? html : (yield fetchText(pagesToCheck[i], { headers: { "Referer": BASE_URL } }));
        if (!pageHtml) continue;
        // Check if page title contains season number
        var titleMatch = pageHtml.match(/<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>([^<]+)/);
        if (titleMatch) {
          var titleText = titleMatch[1];
          // Check Arabic ordinals
          for (var key in arabicSeasonMap) {
            if (titleText.indexOf(key) > -1 && arabicSeasonMap[key] === seasonNum) {
              targetPageUrl = pagesToCheck[i];
              html = pageHtml;
              break;
            }
          }
          // Check numeric
          var numMatch = titleText.match(/(\d+)/g);
          if (numMatch) {
            for (var n = 0; n < numMatch.length; n++) {
              if (parseInt(numMatch[n]) === seasonNum) {
                targetPageUrl = pagesToCheck[i];
                html = pageHtml;
                break;
              }
            }
          }
        }
      }
    }

    // Find episode links on the target page
    var epRegex = /<a[^>]+href="([^"]*\/episode\/[^"]*)"/gi;
    var epLinks = [];
    var em;
    while ((em = epRegex.exec(html)) !== null) {
      epLinks.push(em[1]);
    }

    if (epLinks.length === 0) return null;

    // Match by episode number
    for (var i = 0; i < epLinks.length; i++) {
      var nums = epLinks[i].match(/(\d+)/g);
      if (nums) {
        var lastNum = parseInt(nums[nums.length - 1]);
        if (lastNum === episodeNum) {
          var epUrl = epLinks[i];
          if (!epUrl.startsWith("http")) epUrl = BASE_URL + epUrl;
          return epUrl;
        }
      }
    }

    // Fallback: use positional index
    var idx = episodeNum - 1;
    if (idx >= 0 && idx < epLinks.length) {
      var epUrl = epLinks[idx];
      if (!epUrl.startsWith("http")) epUrl = BASE_URL + epUrl;
      return epUrl;
    }

    return null;
  });
}

// ── Stream extraction (Akwam's multi-step process) ─────────────────────
function extractStreams(pageUrl) {
  return __async(this, null, function* () {
    var html = yield fetchText(pageUrl, { headers: { "Referer": BASE_URL } });
    if (!html) return [];

    // Step 1: Find the "watch" link (a.link-show)
    var watchMatch = html.match(/<a[^>]+class="[^"]*link-show[^"]*"[^>]+href="([^"]+)"/i);
    var pageIdMatch = html.match(/<input[^>]+id="page_id"[^>]+value="([^"]+)"/i);

    if (!watchMatch || !pageIdMatch) {
      console.log("[Akwam] No watch link or page_id found");
      return [];
    }

    var watchPath = watchMatch[1];
    var pageId = pageIdMatch[1];

    // Step 2: Build the watch URL
    var watchSuffix = watchPath;
    var watchIdx = watchPath.indexOf("watch");
    if (watchIdx >= 0) watchSuffix = watchPath.substring(watchIdx + 5);
    watchSuffix = watchSuffix.replace(/^\/+|\/+$/g, "");

    var watchUrl = BASE_URL + "/watch/" + watchSuffix + "/" + pageId;
    watchUrl = watchUrl.replace(/\/\/watch/, "/watch");
    console.log("[Akwam] Watch URL: " + watchUrl);

    // Step 3: Fetch the watch page
    var watchHtml = yield fetchText(watchUrl, { headers: { "Referer": pageUrl } });
    if (!watchHtml) {
      console.log("[Akwam] Failed to fetch watch page");
      return [];
    }

    // Step 4: Extract <source> tags
    var sources = [];
    var sourceRegex = /<source[^>]+src="([^"]+)"[^>]*/gi;
    var sm;
    while ((sm = sourceRegex.exec(watchHtml)) !== null) {
      var videoUrl = sm[0];
      var srcUrl = sm[1].trim().replace(/ /g, "%20");

      var qualityMatch = videoUrl.match(/size="([^"]+)"/i) || videoUrl.match(/label="([^"]+)"/i);
      var quality = qualityMatch ? qualityMatch[1] : "direct";

      sources.push({ url: srcUrl, quality: quality });
    }

    // Deduplicate
    var seen = {};
    var unique = [];
    for (var i = 0; i < sources.length; i++) {
      if (!seen[sources[i].url]) {
        seen[sources[i].url] = true;
        unique.push(sources[i]);
      }
    }

    return unique;
  });
}

function normalizeQuality(q) {
  if (!q) return "Unknown";
  var s = String(q).toUpperCase().trim();
  if (s === "4K" || s === "2160P" || s === "2160") return "4K";
  if (s === "1080P" || s === "1080") return "1080p";
  if (s === "720P" || s === "720") return "720p";
  if (s === "480P" || s === "480") return "480p";
  if (s === "360P" || s === "360") return "360p";
  if (s === "DIRECT") return "Auto";
  return q;
}

// ── Main entry point ───────────────────────────────────────────────────
function getStreams(tmdbId, mediaType, season, episode) {
  return __async(this, null, function* () {
    try {
      var t0 = Date.now();
      var mType = mediaType === "movie" ? "movie" : "tv";
      var seasonNum = parseInt(season) || 1;
      var episodeNum = parseInt(episode) || 1;
      console.log("[Akwam] Request: " + mType + " " + tmdbId + (mType === "tv" ? " S" + seasonNum + "E" + episodeNum : ""));

      // Step 1: Get TMDB info
      var info = yield getTmdbInfo(tmdbId, mediaType);
      if (!info.titles || info.titles.length === 0) {
        console.log("[Akwam] No titles from TMDB");
        return [];
      }
      console.log("[Akwam] Titles: " + info.titles.join(", ") + " (" + info.year + ")");

      // Step 2: Search Akwam
      var allResults = [];
      for (var i = 0; i < info.titles.length; i++) {
        var results = yield searchAkwam(info.titles[i]);
        allResults = allResults.concat(results);
        if (allResults.length >= 20) break;
      }

      if (allResults.length === 0) {
        console.log("[Akwam] No search results");
        return [];
      }
      console.log("[Akwam] Search results: " + allResults.length);

      // Step 3: Find best match
      var bestResult = null;
      var bestScore = 0;
      for (var i = 0; i < allResults.length; i++) {
        for (var j = 0; j < info.titles.length; j++) {
          var s = scoreTitles(info.titles[j], allResults[i].title);
          if (s > bestScore) { bestScore = s; bestResult = allResults[i]; }
        }
      }
      if (!bestResult || bestScore < 30) {
        console.log("[Akwam] No match above threshold (best: " + bestScore + ")");
        bestResult = allResults[0]; // Use first result as fallback
      }
      console.log("[Akwam] Matched: " + bestResult.title + " (score: " + bestScore + ")");

      // Step 4: Find episode/movie page
      var targetUrl;
      if (info.isMovie) {
        targetUrl = bestResult.url;
        if (!targetUrl.startsWith("http")) targetUrl = BASE_URL + targetUrl;
      } else {
        var showUrl = bestResult.url;
        if (!showUrl.startsWith("http")) showUrl = BASE_URL + showUrl;
        targetUrl = yield findEpisodeUrl(showUrl, seasonNum, episodeNum);
      }

      if (!targetUrl) {
        console.log("[Akwam] Target page not found");
        return [];
      }
      console.log("[Akwam] Target: " + targetUrl);

      // Step 5: Extract streams
      var sources = yield extractStreams(targetUrl);
      console.log("[Akwam] Sources: " + sources.length);

      // Step 6: Build stream objects
      var streams = [];
      for (var i = 0; i < sources.length; i++) {
        var src = sources[i];
        var quality = normalizeQuality(src.quality);
        streams.push({
          name: "Akwam " + quality,
          title: quality,
          url: src.url,
          quality: quality,
          size: "",
          headers: { "Referer": BASE_URL + "/" },
          subtitles: [],
          provider: "akwam"
        });
      }

      console.log("[Akwam] === Done: " + streams.length + " streams in " + (Date.now() - t0) + "ms ===");
      return streams;
    } catch (error) {
      console.error("[Akwam] Error: " + error.message);
      return [];
    }
  });
}

module.exports = { getStreams };
