(function () {
  "use strict";

  var MAX_CELLS = 9;
  var HOVER_DELAY = 3000;   // ms of steady hover before a cell starts playing
  var HOVER_VOLUME = 0.12;  // quiet, not silent

  var grid = document.getElementById("grid");
  var overlay = document.getElementById("overlay");
  var stage = document.getElementById("stage");
  var stageLabel = document.getElementById("stage-label");
  var closeBtn = document.getElementById("stage-close");

  var previews = [];
  var gates = [];           // per-cell callbacks run at the first user gesture
  var queue = [];
  var index = 0;
  var current = null;       // the playlist the overlay is showing

  // ------------------------------------------------------- resume position

  // Which video a visitor was last on, per playlist, kept in this browser.
  // Only the position in the playlist is stored, never a time within a file.
  var RESUME = "wall-resume";
  var RESUME_TTL = 6 * 60 * 60 * 1000;   // a stored position expires after six hours

  function resumeAll() {
    try { return JSON.parse(localStorage.getItem(RESUME) || "{}"); }
    catch (e) { return {}; }
  }

  // Clamped and expired on read, so a shortened playlist or a stale position
  // falls back to the start rather than pointing at a video that is gone.
  function resumeGet(id, length) {
    var saved = resumeAll()[id];
    if (!saved || Date.now() - saved.at > RESUME_TTL) return 0;
    return (typeof saved.n === "number" && saved.n >= 0 && saved.n < length) ? saved.n : 0;
  }

  function resumeSet(id, n) {
    var all = resumeAll();
    all[id] = { n: n, at: Date.now() };
    try { localStorage.setItem(RESUME, JSON.stringify(all)); } catch (e) {}
  }

  // Start closed, whatever state the markup or a restored page arrived in.
  overlay.classList.remove("is-open");
  overlay.hidden = true;

  // ------------------------------------------------------------ tv static

  // One set of noise frames is generated once and shared by every cell, so a
  // nine-cell wall costs one blit and one gradient per cell per frame instead
  // of nine separate noise generators. Each cell carries its own scan-line
  // phase so the sweeps do not march in lockstep.
  var TV = (function () {
    var SCALE = 2.5;          // noise pixel size: bigger number, coarser grain
    var SAMPLE_COUNT = 10;    // distinct noise frames in the loop
    var FPS = 50;             // the rate the original effect was timed against
    var SCAN_SECONDS = 15;    // top to bottom for one sweep

    var pointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    var motion = window.matchMedia("(prefers-reduced-motion: reduce)");

    var samples = [];   // offscreen canvases, one per noise frame
    var screens = [];   // { canvas, ctx, offset }
    var w = 0, h = 0, scan = 0;
    var sampleIndex = 0, phase = 0;
    var frame = null;
    var held = false;   // paused while the overlay player is up
    var sizing = null;

    function interpolate(x, x0, y0, x1, y1) {
      return y0 + (y1 - y0) * ((x - x0) / (x1 - x0));
    }

    // Uniform noise with a slow vertical intensity curve laid over it, which
    // is what reads as scan lines rather than flat television snow.
    function makeSample(w, h) {
      var canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;

      var ctx = canvas.getContext("2d");
      var image = ctx.createImageData(w, h);
      var data = image.data;
      var factor = h / 50;
      var alpha = Math.round(255 * (1 - Math.random() * 0.05));
      var i;

      var curve = [];
      for (i = 0; i < Math.floor(h / factor) + factor + 2; i++) {
        curve.push(Math.floor(Math.random() * 15));
      }

      var intensity = [];
      for (i = 0; i < h; i++) {
        var band = Math.floor(i / factor);
        intensity.push(interpolate(i / factor, band, curve[band], band + 1, curve[band + 1]));
      }

      for (i = 0; i < w * h; i++) {
        var k = i * 4;
        var value = Math.floor(36 * Math.random()) + intensity[Math.floor(i / w)];
        data[k] = data[k + 1] = data[k + 2] = value;
        data[k + 3] = alpha;
      }
      ctx.putImageData(image, 0, 0);
      return canvas;
    }

    function band(ctx, y) {
      var grd = ctx.createLinearGradient(0, y, 0, y + scan);
      grd.addColorStop(0, "rgba(255,255,255,0)");
      grd.addColorStop(0.1, "rgba(255,255,255,0)");
      grd.addColorStop(0.2, "rgba(255,255,255,0.2)");
      grd.addColorStop(0.3, "rgba(255,255,255,0)");
      grd.addColorStop(0.45, "rgba(255,255,255,0.1)");
      grd.addColorStop(0.5, "rgba(255,255,255,1)");
      grd.addColorStop(0.55, "rgba(255,255,255,0.55)");
      grd.addColorStop(0.6, "rgba(255,255,255,0.25)");
      grd.addColorStop(1, "rgba(255,255,255,0)");
      return grd;
    }

    // Cells share a size in the grid, so one measurement covers the wall.
    function measure() {
      if (!screens.length) return false;
      var probe = screens[0].canvas;
      var cw = probe.offsetWidth, ch = probe.offsetHeight;
      if (!cw || !ch) return false;

      w = Math.max(2, Math.round(cw / SCALE));
      h = Math.max(2, Math.round(ch / SCALE));
      scan = h / 3;

      screens.forEach(function (s) { s.canvas.width = w; s.canvas.height = h; });
      samples = [];
      for (var i = 0; i < SAMPLE_COUNT; i++) samples.push(makeSample(w, h));
      return true;
    }

    function paint(withBand) {
      var noise = samples[Math.floor(sampleIndex)];
      if (!noise) return;
      screens.forEach(function (s) {
        var ctx = s.ctx;
        ctx.globalCompositeOperation = "source-over";
        ctx.drawImage(noise, 0, 0);
        if (!withBand) return;
        var y = ((phase + s.offset) % 1) * (h + scan) - scan;
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = band(ctx, y);
        ctx.fillRect(0, y, w, scan);
      });
    }

    function render() {
      frame = window.requestAnimationFrame(render);
      if (held || document.hidden || !samples.length) return;

      paint(true);

      sampleIndex += 20 / FPS;
      if (sampleIndex >= samples.length) sampleIndex = 0;

      phase += 1 / (FPS * SCAN_SECONDS);
      if (phase >= 1) phase -= 1;
    }

    function stop() {
      if (frame) window.cancelAnimationFrame(frame);
      frame = null;
    }

    window.addEventListener("resize", function () {
      clearTimeout(sizing);
      sizing = setTimeout(function () { if (screens.length) measure(); }, 200);
    });

    return {
      // Nothing to fade away from on a touch screen, so it is never built.
      wanted: function () { return pointer.matches; },

      reset: function () {
        stop();
        screens = [];
        samples = [];
      },

      attach: function (cell) {
        if (!pointer.matches) return;
        var canvas = document.createElement("canvas");
        canvas.className = "cell-tv";
        canvas.setAttribute("aria-hidden", "true");
        cell.appendChild(canvas);
        screens.push({ canvas: canvas, ctx: canvas.getContext("2d"), offset: Math.random() });
      },

      start: function () {
        if (!pointer.matches || !screens.length) return;
        if (!measure()) return;
        sampleIndex = 0;
        phase = 0;
        if (motion.matches) { paint(false); return; }   // one still frame, no sweep
        if (!frame) frame = window.requestAnimationFrame(render);
      },

      hold: function (on) { held = !!on; }
    };
  })();

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

    var playlists = (data.playlists || [])
      .filter(function (p) { return p.visible !== false; })
      .slice(0, MAX_CELLS)
      .map(function (p) {
        return {
          id: p.id || p.name || "",
          name: p.name || "Untitled",
          poster: p.poster ? url(base, p.poster) : "",
          videos: (p.videos || []).map(function (v) {
            return { name: v.name || v.src, src: url(base, v.src) };
          })
        };
      });

    grid.innerHTML = "";
    previews = [];
    gates = [];
    TV.reset();

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

    TV.start();
  }

  // ------------------------------------------------------------ cell parts

  // The picture lives inside .cell-screen, which is inset to the bezel
  // opening. That opening is not centred: the bottom of the frame is much
  // deeper than the top, so the screen sits high in the cell. CSS owns the
  // numbers; this just builds the box.
  function screenOf(cell) {
    var div = document.createElement("div");
    div.className = "cell-screen";
    cell.appendChild(div);
    return div;
  }

  // Nine-piece bezel. Corners hold their proportions at any cell size and the
  // four edges tile, so a cell can change shape without the moulding
  // stretching. Sits above the picture and takes no clicks.
  function frame() {
    var wrap = document.createElement("div");
    wrap.className = "cell-frame";
    wrap.setAttribute("aria-hidden", "true");
    // Corners are added last so they paint over the ends of the edge strips.
    ["t", "b", "l", "r", "tl", "tr", "bl", "br"].forEach(function (part) {
      var piece = document.createElement("i");
      piece.className = part;
      wrap.appendChild(piece);
    });
    return wrap;
  }

  function cell(playlist) {
    var button = document.createElement("button");
    button.className = "cell";
    button.type = "button";

    // The cell opens on wherever this visitor left off and stays there for the
    // whole page load, so hover only ever plays the video on screen.
    var cursor = resumeGet(playlist.id, playlist.videos.length);

    var video = document.createElement("video");
    if (playlist.poster) video.poster = playlist.poster;
    video.muted = true;
    video.volume = HOVER_VOLUME;
    video.playsInline = true;
    video.setAttribute("aria-hidden", "true");

    // Metadata plus the opening frame, so a cell shows its picture while idle
    // without pulling the body of the file down. Nothing plays until hovered.
    video.preload = "metadata";
    video.src = firstFrame(playlist.videos[cursor].src);

    // Bottom-right position counter, e.g. "1 of 2".
    var counter = document.createElement("p");
    counter.className = "cell-index";
    function mark() {
      counter.textContent = (cursor + 1) + " of " + playlist.videos.length;
    }
    mark();

    // Hovering arms a timer rather than acting at once, so sweeping the pointer
    // across the wall wakes nothing. After the delay the cell plays, quietly.
    var timer = null;
    var awake = false;

    function wake() {
      timer = null;
      if (overlay.classList.contains("is-open")) return;
      awake = true;
      hush();                       // only one cell is ever audible
      video.volume = HOVER_VOLUME;

      // Start muted, the one thing every browser allows, and lift the mute
      // once playback is genuinely running. Unmuting a cold, paused element
      // is refused outright, which is why the sound used to go missing.
      video.muted = true;
      var started = video.play();
      if (started && started.then) started.then(sound, noop);
      else sound();
    }

    function sound() {
      if (!awake || video.paused) return;
      video.muted = false;
      var again = video.play();
      if (again && again.catch) again.catch(silence);
      // Chrome can pull the plug on an unmuted element without rejecting the
      // promise, so check a moment later and settle for a silent picture.
      setTimeout(function () { if (awake && video.paused) silence(); }, 300);
    }

    function silence() {
      if (!awake) return;
      video.muted = true;
      video.play().catch(noop);
    }

    function hoverIn() {
      if (timer) return;
      timer = setTimeout(wake, HOVER_DELAY);
    }

    function hoverOut() {
      clearTimeout(timer);
      timer = null;
      awake = false;
      video.muted = true;
      video.pause();
    }

    button.addEventListener("mouseenter", hoverIn);
    button.addEventListener("mouseleave", hoverOut);
    button.addEventListener("focus", hoverIn);
    button.addEventListener("blur", hoverOut);

    // Run at the first click or key press anywhere on the page. A cell that is
    // already hovered and stuck silent gets another go at its sound; the rest
    // are blessed so they can be unmuted later without a gesture of their own.
    gates.push(function () {
      if (awake) sound();
      else bless(video);
    });

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

    // Hover playback never leaves the video the cell opened with. Reaching the
    // end counts as a watch, so the stored position moves on and the next page
    // load opens this cell on the following video. This pass just loops.
    video.addEventListener("ended", function () {
      resumeSet(playlist.id, (cursor + 1) % playlist.videos.length);
      try { video.currentTime = 0; } catch (e) {}
      if (awake) video.play().catch(noop);
    });
    previews.push(video);

    var label = document.createElement("p");
    label.className = "cell-name";
    label.textContent = playlist.name;

    var screen = screenOf(button);
    screen.appendChild(video);
    TV.attach(screen);
    screen.appendChild(label);
    screen.appendChild(counter);
    button.appendChild(frame());
    button.addEventListener("click", function () { open(playlist); });
    return button;
  }

  function emptyCell(playlist) {
    var div = document.createElement("div");
    div.className = "cell is-empty";
    var screen = screenOf(div);
    TV.attach(screen);
    var label = document.createElement("p");
    label.className = "cell-name";
    label.textContent = playlist.name + " has no videos yet";
    screen.appendChild(label);
    div.appendChild(frame());
    return div;
  }

  function blankCell() {
    var div = document.createElement("div");
    div.className = "cell is-blank";
    div.setAttribute("aria-hidden", "true");
    TV.attach(screenOf(div));
    div.appendChild(frame());
    return div;
  }

  function noop() {}

  function hush() {
    previews.forEach(function (v) { v.muted = true; });
  }

  // ---------------------------------------------------------- audio gate

  // Browsers refuse unmuted playback until the page has had a real user
  // gesture. Moving the pointer is not one, which is why the first hover is
  // silent while every hover after the first overlay click has sound. There is
  // no way around the rule, but one click or key press anywhere will do, and
  // it need not land on a cell.
  var unlocked = false;

  // Starting an element inside the gesture and stopping it again marks that
  // element as allowed to play, which is what Safari wants. Chrome unlocks the
  // whole document on the same gesture, so this costs it a frame and nothing else.
  function bless(video) {
    video.muted = true;
    var started = video.play();
    var settle = function () {
      video.pause();
      try { video.currentTime = 0.001; } catch (e) {}
    };
    if (started && started.then) started.then(settle, noop);
    else settle();
  }

  function unlockAudio() {
    if (unlocked) return;
    unlocked = true;
    gates.forEach(function (gate) { gate(); });
  }

  document.addEventListener("pointerdown", unlockAudio, true);
  document.addEventListener("keydown", unlockAudio, true);

  // ------------------------------------------------------------- overlay

  function open(playlist) {
    current = playlist;
    queue = playlist.videos;
    index = resumeGet(playlist.id, queue.length);
    overlay.hidden = false;
    overlay.classList.add("is-open");
    document.documentElement.style.overflow = "hidden";
    hush();
    previews.forEach(function (v) { v.pause(); });
    TV.hold(true);            // nothing behind the player needs drawing
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
    if (current) resumeSet(current.id, index);
    play();
  });

  function close() {
    if (current) resumeSet(current.id, index);
    stage.pause();
    stage.removeAttribute("src");
    stage.load();
    overlay.classList.remove("is-open");
    overlay.hidden = true;
    document.documentElement.style.overflow = "";
    TV.hold(false);
    queue = [];
    current = null;
  }

  // Clicking the surround closes; clicks on the player belong to its controls.
  overlay.addEventListener("click", close);
  stage.addEventListener("click", function (e) { e.stopPropagation(); });
  closeBtn.addEventListener("click", function (e) { e.stopPropagation(); close(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && overlay.classList.contains("is-open")) close();
  });
})();