(function () {
  "use strict";

  var MAX_CELLS = 9;
  var HOVER_DELAY = 3000;   // ms of steady hover before a cell wakes up
  var HOVER_VOLUME = 0.12;  // quiet, not silent

  var grid = document.getElementById("grid");
  var overlay = document.getElementById("overlay");
  var stage = document.getElementById("stage");
  var stageLabel = document.getElementById("stage-label");
  var closeBtn = document.getElementById("stage-close");

  var previews = [];
  var queue = [];
  var index = 0;
  var mode = "auto";

  // Start closed, whatever state the markup or a restored page arrived in.
  overlay.classList.remove("is-open");
  overlay.hidden = true;

  // Never smaller than 2x2. Past four playlists it grows to 3x2, then 3x3.
  // Leftover slots stay black rather than stretching the cells with content.
  function shape(count) {
    var cols = Math.max(2, Math.ceil(Math.sqrt(count)));
    var rows = Math.max(2, Math.ceil(count / cols));
    return { cols: cols, rows: rows, slots: cols * rows };
  }

  function url(base, src) {
    if (/^https?:\/\//i.test(src)) return src;
    return (base || "").replace(/\/+$/, "") + "/" + src.replace(/^\/+/, "");
  }

  // A media fragment a hair past zero makes the browser seek and decode, so the
  // cell paints its opening frame instead of sitting as a black square.
  function firstFrame(src) {
    return /#t=/.test(src) ? src : src + "#t=0.001";
  }

  // Cache-busting query so a freshly published file is not served from cache.
  fetch("playlists.json?v=" + Date.now(), { cache: "no-store" })
    .then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    })
    .then(render)
    .catch(function () {
      grid.className = "blank";
      grid.innerHTML = "<p>playlists.json could not be loaded. Check that it sits next to index.html and contains valid JSON.</p>";
    });

  function render(data) {
    var base = data.mediaBase || "";

    if (/YOUR-ZONE/i.test(base) || !base) {
      grid.className = "blank";
      grid.innerHTML = '<p>This wall still has its placeholder settings. Open ' +
        '<a href="admin.html">the admin page</a>, set your Bunny pull zone URL, ' +
        'add a playlist, and publish.</p>';
      return;
    }

    mode = data.previews === "hover" ? "hover" : "auto";

    var playlists = (data.playlists || [])
      .filter(function (p) { return p.visible !== false; })
      .slice(0, MAX_CELLS)
      .map(function (p) {
        return {
          name: p.name || "Untitled",
          poster: p.poster ? url(base, p.poster) : "",
          videos: (p.videos || []).map(function (v) {
            return { name: v.name || v.src, src: url(base, v.src) };
          })
        };
      });

    grid.innerHTML = "";
    previews = [];

    if (!playlists.length) {
      grid.className = "blank";
      grid.innerHTML = '<p>No playlists are showing yet. Open <a href="admin.html">the admin page</a> to build one.</p>';
      return;
    }

    var box = shape(playlists.length);
    grid.className = "grid";
    grid.style.setProperty("--cols", box.cols);
    grid.style.setProperty("--rows", box.rows);

    playlists.forEach(function (playlist) {
      grid.appendChild(playlist.videos.length ? cell(playlist) : emptyCell(playlist));
    });
    for (var i = playlists.length; i < box.slots; i++) grid.appendChild(blankCell());
  }

  function cell(playlist) {
    var button = document.createElement("button");
    button.className = "cell";
    button.type = "button";

    var cursor = 0;

    var video = document.createElement("video");
    if (playlist.poster) video.poster = playlist.poster;
    video.muted = true;
    video.volume = HOVER_VOLUME;
    video.loop = playlist.videos.length === 1;
    video.playsInline = true;
    video.setAttribute("aria-hidden", "true");

    // Metadata plus the opening frame in both modes, so no cell starts black.
    // Hover mode still holds off on the rest of the file until the pointer
    // rests, which is where most of the CDN bandwidth goes.
    video.preload = "metadata";
    video.src = firstFrame(playlist.videos[0].src);

    if (mode !== "hover") {
      video.autoplay = true;
      video.play().catch(noop);
    }

    // Bottom-right position counter, e.g. "1 of 2".
    var counter = document.createElement("p");
    counter.className = "cell-index";
    function mark() {
      counter.textContent = (cursor + 1) + " of " + playlist.videos.length;
    }
    mark();

    // Hovering arms a timer rather than acting at once, so sweeping the pointer
    // across the wall wakes nothing. After the delay the cell plays with sound.
    var timer = null;

    function wake() {
      timer = null;
      if (overlay.classList.contains("is-open")) return;
      hush();                       // only one cell is ever audible
      video.volume = HOVER_VOLUME;
      video.muted = false;
      video.play().catch(function () {
        // Browsers refuse unmuted playback without a user gesture; take the
        // picture without the sound rather than nothing at all.
        video.muted = true;
        video.play().catch(noop);
      });
    }

    function hoverIn() {
      if (timer) return;
      timer = setTimeout(wake, HOVER_DELAY);
    }

    function hoverOut() {
      clearTimeout(timer);
      timer = null;
      video.muted = true;
      if (mode === "hover") video.pause();
    }

    button.addEventListener("mouseenter", hoverIn);
    button.addEventListener("mouseleave", hoverOut);
    button.addEventListener("focus", hoverIn);
    button.addEventListener("blur", hoverOut);

    video.addEventListener("error", function () {
      button.classList.add("is-broken");
      var flag = label.querySelector(".cell-flag");
      if (!flag) {
        flag = document.createElement("span");
        flag.className = "cell-flag";
        label.appendChild(flag);
      }
      flag.textContent = "  file not loading";
      button.title = "Could not load " + video.src;
    });

    video.addEventListener("ended", function () {
      cursor = (cursor + 1) % playlist.videos.length;
      video.src = playlist.videos[cursor].src;
      mark();
      video.play().catch(noop);
    });
    previews.push(video);

    var label = document.createElement("p");
    label.className = "cell-name";
    label.textContent = playlist.name;

    button.appendChild(video);
    button.appendChild(label);
    button.appendChild(counter);
    button.addEventListener("click", function () { open(playlist); });
    return button;
  }

  function emptyCell(playlist) {
    var div = document.createElement("div");
    div.className = "cell is-empty";
    var label = document.createElement("p");
    label.className = "cell-name";
    label.textContent = playlist.name + " has no videos yet";
    div.appendChild(label);
    return div;
  }

  function blankCell() {
    var div = document.createElement("div");
    div.className = "cell is-blank";
    div.setAttribute("aria-hidden", "true");
    return div;
  }

  function noop() {}

  function hush() {
    previews.forEach(function (v) { v.muted = true; });
  }

  // ------------------------------------------------------------- overlay

  function open(playlist) {
    queue = playlist.videos;
    index = 0;
    overlay.hidden = false;
    overlay.classList.add("is-open");
    document.documentElement.style.overflow = "hidden";
    hush();
    previews.forEach(function (v) { v.pause(); });
    play();
  }

  function play() {
    if (!queue.length) return close();
    stage.src = queue[index].src;
    stageLabel.className = "stage-label";
    stageLabel.textContent =
      queue.length > 1 ? queue[index].name + "  \u00b7  " + (index + 1) + " of " + queue.length : "";
    stage.play().catch(noop);
  }

  stage.addEventListener("error", function () {
    stageLabel.className = "stage-label bad";
    stageLabel.textContent = "Could not load this file. Check the path in the admin page: " +
      (queue[index] ? queue[index].src : "");
  });

  stage.addEventListener("ended", function () {
    index += 1;
    if (index >= queue.length) index = 0;
    play();
  });

  function close() {
    stage.pause();
    stage.removeAttribute("src");
    stage.load();
    overlay.classList.remove("is-open");
    overlay.hidden = true;
    document.documentElement.style.overflow = "";
    queue = [];
    if (mode === "auto") previews.forEach(function (v) { v.play().catch(noop); });
  }

  // Clicking the surround closes; clicks on the player belong to its controls.
  overlay.addEventListener("click", close);
  stage.addEventListener("click", function (e) { e.stopPropagation(); });
  closeBtn.addEventListener("click", function (e) { e.stopPropagation(); close(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && overlay.classList.contains("is-open")) close();
  });
})();
