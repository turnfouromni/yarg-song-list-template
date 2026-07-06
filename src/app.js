(function () {
  "use strict";

  var SONGS = JSON.parse(document.getElementById("song-data").textContent);

  // ---- helpers ----
  function fmtLen(ms) {
    var s = Math.round((ms || 0) / 1000);
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m + ":" + (r < 10 ? "0" : "") + r;
  }
  function letterOf(str) {
    var c = (str || "").trim().toUpperCase().charAt(0);
    return c >= "A" && c <= "Z" ? c : "#";
  }
  // Sort key: strip leading "The " and non-alphanumerics for natural grouping.
  function sortKey(str) {
    return (str || "")
      .toLowerCase()
      .replace(/^(the|a|an)\s+/, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }
  function esc(s) {
    return (s == null ? "" : String(s)).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  // Precompute sort keys once.
  SONGS.forEach(function (s) {
    s._name = s.Name || "";
    s._artist = s.Artist || "";
    s._kname = sortKey(s._name);
    s._kartist = sortKey(s._artist);
    s._searchable = (s._name + " " + s._artist).toLowerCase();
    s._len = fmtLen(s.songlength);
  });

  // Distinct genres, alphabetical.
  var GENRES = (function () {
    var set = {};
    SONGS.forEach(function (s) { if (s.Genre) set[s.Genre] = true; });
    return Object.keys(set).sort(function (a, b) {
      return a.toLowerCase() < b.toLowerCase() ? -1 : 1;
    });
  })();

  // ---- state ----
  var state = { sort: "artist", query: "", genres: {} };
  var collapsed = {};        // artist name -> true when its songs are hidden
  var currentArtists = [];   // distinct artists in the last render (for collapse-all)

  var main = document.getElementById("main");
  var countEl = document.getElementById("count");
  var searchEl = document.getElementById("search");
  var hdrEl = document.querySelector("header");

  // The page header (search/sort) is sticky; the frozen column header and the
  // sticky group separators must sit below it. Header height varies (it wraps
  // on mobile), so measure it and expose it as a CSS variable.
  var rootStyle = document.documentElement.style;
  function syncOffsets() {
    rootStyle.setProperty("--hdr", hdrEl.offsetHeight + "px");
    var thead = main.querySelector("thead");
    if (thead) rootStyle.setProperty("--thead", thead.offsetHeight + "px");
  }

  // ---- album art ----
  // Covers are downloaded and self-hosted at build time (see build.mjs); each
  // song carries its art path (or null). Just render it — no runtime fetches.
  function artCell(s) {
    return s.art
      ? '<td class="art"><img src="' + esc(s.art) + '" alt="" loading="lazy"></td>'
      : '<td class="art"><span class="art-ph"></span></td>';
  }

  var genreBtn = document.getElementById("genre-btn");
  var genrePanel = document.getElementById("genre-panel");
  var collapseBtn = document.getElementById("collapse-toggle");

  function anyGenre() {
    for (var k in state.genres) { if (state.genres[k]) return true; }
    return false;
  }

  function filterSongs() {
    var q = state.query, hasG = anyGenre();
    var list = SONGS.filter(function (s) {
      if (q && s._searchable.indexOf(q) === -1) return false;
      if (hasG && !state.genres[s.Genre]) return false;
      return true;
    });
    var primary = state.sort === "artist" ? "_kartist" : "_kname";
    var secondary = state.sort === "artist" ? "_kname" : "_kartist";
    list.sort(function (a, b) {
      var av = a[primary], bv = b[primary];
      if (av < bv) return -1;
      if (av > bv) return 1;
      // Keep two distinct artists that share a normalized key (e.g. "Beatles"
      // vs "The Beatles") from interleaving — group by the raw artist first.
      if (state.sort === "artist" && a._artist !== b._artist) {
        return a._artist < b._artist ? -1 : 1;
      }
      // Within a group, order ascending (songs A-Z under each artist).
      var as = a[secondary], bs = b[secondary];
      return as < bs ? -1 : as > bs ? 1 : 0;
    });
    return list;
  }

  function renderSongs(list) {
    var byArtist = state.sort === "artist";

    // Per-artist song counts for the group headers (reflects current filter).
    var counts = {};
    if (byArtist) list.forEach(function (s) { counts[s._artist] = (counts[s._artist] || 0) + 1; });
    currentArtists = Object.keys(counts);

    var html = [
      '<table><thead><tr>',
      '<th class="art-h" aria-hidden="true"></th>',
      '<th class="sortable" data-sort="name">Song', arrow("name"), '</th>',
      '<th class="sortable" data-sort="artist">Artist', arrow("artist"), '</th>',
      '<th>Album</th>',
      '<th>Genre</th>',
      '<th class="num">Year</th>',
      '<th class="num">Length</th>',
      '</tr></thead><tbody>'
    ];
    var seen = {};        // letters present -> for the A-Z rail
    var lastArtist = null;
    for (var i = 0; i < list.length; i++) {
      var s = list[i];

      if (byArtist) {
        // One collapsible header per distinct artist; carries the rail anchor
        // for the first artist of each new letter. Songs beneath are A-Z.
        if (s._artist !== lastArtist) {
          lastArtist = s._artist;
          var La = letterOf(s._kartist), idA = "";
          if (!seen[La]) { seen[La] = true; idA = ' id="L-' + La.charCodeAt(0) + '"'; }
          var col = !!collapsed[s._artist];
          html.push(
            '<tr class="artist-sep"' + idA + ' data-artist="' + esc(s._artist) + '"><td colspan="7">',
            '<span class="caret">', col ? "▸" : "▾", '</span>',
            esc(s._artist),
            ' <span class="asub">', counts[s._artist], ' song', counts[s._artist] === 1 ? "" : "s", '</span>',
            '</td></tr>'
          );
        }
        if (collapsed[s._artist]) continue;   // hide songs of collapsed artists
      } else {
        // Sort by song name: a letter header per bucket.
        var L = letterOf(s._kname);
        if (!seen[L]) {
          seen[L] = true;
          html.push('<tr class="alpha-sep" id="L-' + L.charCodeAt(0) + '"><td colspan="7">' + esc(L) + '</td></tr>');
        }
      }

      html.push(
        '<tr>',
        artCell(s),
        '<td class="t-name">', esc(s._name), '</td>',
        '<td class="t-artist">', esc(s._artist), '</td>',
        '<td class="t-sub meta" data-label="Album">', esc(s.Album), '</td>',
        '<td class="t-sub meta" data-label="Genre">', esc(s.Genre), '</td>',
        '<td class="num t-sub meta" data-label="Year">', esc(s.Year), '</td>',
        '<td class="num meta" data-label="Length">', s._len, '</td>',
        '</tr>'
      );
    }
    html.push('</tbody></table>');
    if (!list.length) {
      html = [SONGS.length
        ? '<div class="empty">No songs match your filters.</div>'
        : '<div class="empty">No songs yet — add entries to <code>songs.json</code> and push to rebuild.</div>'];
    }
    main.innerHTML = html.join("");
    return seen;
  }

  function arrow(which) {
    return state.sort === which ? ' <span class="arrow">▲</span>' : "";
  }

  function render() {
    var list = filterSongs();
    renderSongs(list);
    countEl.textContent = list.length + " of " + SONGS.length + " songs";
    syncOffsets();

    // Collapsing only applies when grouped by artist — keep the button in place
    // but disable it when sorting by song name (don't reflow the toolbar).
    var isArtist = state.sort === "artist";
    collapseBtn.disabled = !isArtist;
    var allCol = isArtist && currentArtists.length > 0 && currentArtists.every(function (a) { return collapsed[a]; });
    collapseBtn.textContent = allCol ? "Expand" : "Collapse";
  }

  // ---- genre dropdown ----
  genrePanel.innerHTML = GENRES.map(function (g) {
    return '<label><input type="checkbox" value="' + esc(g) + '">' + esc(g) + "</label>";
  }).join("");

  function updateGenreBtn() {
    var n = 0;
    for (var k in state.genres) { if (state.genres[k]) n++; }
    genreBtn.textContent = n ? "Genres (" + n + ")" : "Genres";
    genreBtn.classList.toggle("on", n > 0);
  }

  function toggleGenrePanel(open) {
    var show = open == null ? genrePanel.hidden : open;
    genrePanel.hidden = !show;
    genreBtn.setAttribute("aria-expanded", show ? "true" : "false");
  }

  genreBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    toggleGenrePanel();
  });
  genrePanel.addEventListener("change", function (e) {
    var cb = e.target;
    if (cb.type !== "checkbox") return;
    if (cb.checked) state.genres[cb.value] = true; else delete state.genres[cb.value];
    updateGenreBtn();
    render();
  });
  // Close the panel when clicking outside it.
  document.addEventListener("click", function (e) {
    if (!genrePanel.hidden && !e.target.closest("#genre-dd")) toggleGenrePanel(false);
  });

  // ---- reset ----
  document.getElementById("reset-btn").addEventListener("click", function () {
    state.genres = {};
    state.query = "";
    collapsed = {};
    searchEl.value = "";
    [].forEach.call(genrePanel.querySelectorAll("input"), function (cb) { cb.checked = false; });
    updateGenreBtn();
    toggleGenrePanel(false);
    window.scrollTo(0, 0);
    render();
  });

  // ---- sort (radio group) ----
  document.getElementById("sortgroup").addEventListener("change", function (e) {
    if (e.target.name === "sort") setSort(e.target.value);
  });

  function setSort(key) {
    if (state.sort === key) return;
    state.sort = key;
    [].forEach.call(document.querySelectorAll('#sortgroup input[name="sort"]'), function (r) {
      r.checked = r.value === key;
    });
    window.scrollTo(0, 0);
    render();
  }

  // ---- collapse ----
  collapseBtn.addEventListener("click", function () {
    var allCol = currentArtists.length > 0 && currentArtists.every(function (a) { return collapsed[a]; });
    if (allCol) collapsed = {};
    else currentArtists.forEach(function (a) { collapsed[a] = true; });
    render();
  });

  // Table clicks: sort header, or toggle an artist group.
  main.addEventListener("click", function (e) {
    var th = e.target.closest("th.sortable");
    if (th) { setSort(th.dataset.sort); return; }
    var sep = e.target.closest(".artist-sep");
    if (sep) {
      var a = sep.getAttribute("data-artist");
      if (collapsed[a]) delete collapsed[a]; else collapsed[a] = true;
      render();
    }
  });

  var t;
  searchEl.addEventListener("input", function () {
    clearTimeout(t);
    t = setTimeout(function () {
      state.query = searchEl.value.trim().toLowerCase();
      render();
    }, 90);
  });

  // ---- random-song modal ----
  var modal = document.getElementById("random-modal");
  var randomContent = document.getElementById("random-content");
  // Pick from the whole library — deliberately ignores search + genre filters.
  function pickRandom() {
    var s = SONGS[Math.floor(Math.random() * SONGS.length)];
    randomContent.innerHTML =
      (s.art ? '<img class="rand-art" src="' + esc(s.art) + '" alt="">' : '<div class="rand-art art-ph"></div>') +
      '<div class="rand-title">' + esc(s._name) + '</div>' +
      '<div class="rand-artist">' + esc(s._artist) + '</div>';
  }
  function openModal() { pickRandom(); modal.hidden = false; }
  function closeModal() { modal.hidden = true; }
  var randomBtn = document.getElementById("random-btn");
  randomBtn.addEventListener("click", openModal);
  randomBtn.disabled = SONGS.length === 0;   // nothing to pick from yet
  document.getElementById("reroll-btn").addEventListener("click", pickRandom);
  document.getElementById("modal-close").addEventListener("click", closeModal);
  modal.addEventListener("click", function (e) { if (e.target === modal) closeModal(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !modal.hidden) closeModal(); });

  window.addEventListener("resize", syncOffsets);

  render();
})();
