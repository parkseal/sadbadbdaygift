(function () {
  "use strict";

  var MAX_CELLS = 9;

  var grid = document.getElementById("grid");
  var overlay = document.getElementById("overlay");
  var stage = document.getElementById("stage");
  var stageLabel = document.getElementById("stage-label");
  var closeBtn = document.getElementById("stage-close");

  var previews = [];
  var queue = [];
  var index = 0;
  var mode = "auto";

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

    var video = document.createElement("video");
    video.src = playlist.videos[0].src;
    if (playlist.poster) video.poster = playlist.poster;
    video.muted = true;
    video.loop = playlist.videos.length === 1;
    video.playsInline = true;
    video.setAttribute("aria-hidden", "true");

    // In hover mode nothing downloads until the pointer lands on the cell,
    // which keeps CDN bandwidth down on a wall that is mostly idle.
    if (mode === "hover") {
      video.preload = "none";
      button.addEventListener("mouseenter", function () { video.play().catch(noop); });
      button.addEventListener("mouseleave", function () { video.pause(); });
      button.addEventListener("focus", function () { video.play().catch(noop); });
      button.addEventListener("blur", function () { video.pause(); });
    } else {
      video.preload = "metadata";
      video.autoplay = true;
      video.play().catch(noop);
    }

    var cursor = 0;
    video.addEventListener("ended", function () {
      cursor = (cursor + 1) % playlist.videos.length;
      video.src = playlist.videos[cursor].src;
      video.play().catch(noop);
    });
    previews.push(video);

    var label = document.createElement("p");
    label.className = "cell-name";
    label.textContent = playlist.name;
    if (playlist.videos.length > 1) {
      var count = document.createElement("span");
      count.className = "cell-count";
      count.textContent = "  " + playlist.videos.length + " videos";
      label.appendChild(count);
    }

    button.appendChild(video);
    button.appendChild(label);
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

  // ------------------------------------------------------------- overlay

  function open(playlist) {
    queue = playlist.videos;
    index = 0;
    overlay.hidden = false;
    document.documentElement.style.overflow = "hidden";
    previews.forEach(function (v) { v.pause(); });
    play();
  }

  function play() {
    if (!queue.length) return close();
    stage.src = queue[index].src;
    stageLabel.textContent =
      queue.length > 1 ? queue[index].name + "  \u00b7  " + (index + 1) + " of " + queue.length : "";
    stage.play().catch(noop);
  }

  stage.addEventListener("ended", function () {
    index += 1;
    if (index >= queue.length) index = 0;
    play();
  });

  function close() {
    stage.pause();
    stage.removeAttribute("src");
    stage.load();
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
    if (e.key === "Escape" && !overlay.hidden) close();
  });
})();
