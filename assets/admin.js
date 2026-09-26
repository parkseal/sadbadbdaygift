(function () {
  "use strict";

  var MAX_CELLS = 9;
  var FILE = "playlists.json";
  var STORE = "wall-admin";

  // Storage listing limits, so a deep zone cannot spin forever.
  var LIB_DEPTH = 3;      // folder levels below the root
  var LIB_MAX = 2000;     // files kept
  var VIDEO = /\.(mp4|webm|mov|m4v|ogv|ogg)$/i;

  var data = { mediaBase: "", playlists: [] };
  var library = [];       // { src, size, at }
  var selected = null;
  var dragging = null;    // src being dragged, for the in-page drop targets
  var dirty = false;

  var $ = function (id) { return document.getElementById(id); };

  // ------------------------------------------------------------- helpers

  function say(message, bad) {
    var toast = $("toast");
    toast.textContent = message;
    toast.className = bad ? "toast bad" : "toast";
    toast.hidden = false;
    clearTimeout(say.timer);
    say.timer = setTimeout(function () { toast.hidden = true; }, 5000);
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function uid() {
    return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function move(list, from, to) {
    list.splice(to, 0, list.splice(from, 1)[0]);
  }

  function size(bytes) {
    if (!bytes && bytes !== 0) return "";
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1048576).toFixed(1) + " MB";
    return (bytes / 1073741824).toFixed(2) + " GB";
  }

  function touched(keepCaretIn) {
    dirty = true;
    $("publish-note").textContent = "unpublished changes";
    $("publish-note").className = "meta alert";
    saveLocal();
    draw();
    if (keepCaretIn) {
      var input = document.querySelector('.row[data-id="' + keepCaretIn + '"] .name');
      if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    }
  }

  // One file belongs to one playlist. Paths are compared loosely so a stray
  // leading slash or a change of case is not read as a different video.
  function key(src) {
    return String(src || "").trim().replace(/^\/+/, "").toLowerCase();
  }

  function holderOf(src, ignore) {
    var k = key(src), hit = null;
    data.playlists.forEach(function (p) {
      p.videos.forEach(function (v) {
        if (!hit && v !== ignore && key(v.src) === k) hit = p;
      });
    });
    return hit;
  }

  function arrows(canUp, canDown, onUp, onDown) {
    var wrap = el("div", "arrows");
    var up = el("button", "tiny", "\u2191");
    up.type = "button"; up.title = "Move up"; up.disabled = !canUp;
    up.addEventListener("click", onUp);
    var down = el("button", "tiny", "\u2193");
    down.type = "button"; down.title = "Move down"; down.disabled = !canDown;
    down.addEventListener("click", onDown);
    wrap.appendChild(up); wrap.appendChild(down);
    return wrap;
  }

  // Matches the grid maths in wall.js.
  function shape(count) {
    var cols = Math.max(2, Math.ceil(Math.sqrt(count)));
    var rows = Math.max(2, Math.ceil(count / cols));
    return { cols: cols, rows: rows, slots: cols * rows };
  }

  // ------------------------------------------------- local draft storage

  function saveLocal() {
    try { localStorage.setItem(STORE + ":draft", JSON.stringify(data)); } catch (e) {}
  }

  function settings(patch) {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORE + ":gh") || "{}"); } catch (e) {}
    if (patch) {
      Object.keys(patch).forEach(function (k) { saved[k] = patch[k]; });
      try { localStorage.setItem(STORE + ":gh", JSON.stringify(saved)); } catch (e) {}
    }
    return saved;
  }

  // ---------------------------------------------------- settings drawer

  function drawer(open) {
    $("settings").hidden = !open;
    $("settings-toggle").setAttribute("aria-expanded", open ? "true" : "false");
    $("settings-toggle").classList.toggle("on", open);
    try { localStorage.setItem(STORE + ":settings-open", open ? "1" : ""); } catch (e) {}
  }

  $("settings-toggle").addEventListener("click", function () {
    drawer($("settings").hidden);
  });

  // ------------------------------------------------------------- drawing

  function draw() {
    // Old rows are on their way out, so stop watching them and drop any work
    // queued against boxes that are about to be detached.
    if (watcher) watcher.disconnect();
    thumbQueue = [];
    drawPlaylists();
    drawItems();
    drawLibrary();
    drawShape();
  }

  function drawShape() {
    var visible = data.playlists.filter(function (p) { return p.visible !== false; }).length;
    var capped = Math.min(visible, MAX_CELLS);
    if (!capped) { $("shape").textContent = "empty wall"; return; }
    var box = shape(capped);
    var blanks = box.slots - capped;
    $("shape").textContent =
      box.cols + "x" + box.rows + " grid" + (blanks ? ", " + blanks + " black" : "");
  }

  function drawPlaylists() {
    var list = $("playlists");
    var note = $("cap-note");
    list.innerHTML = "";

    var visible = data.playlists.filter(function (p) { return p.visible !== false; }).length;
    if (!data.playlists.length) {
      note.textContent = "Up to " + MAX_CELLS + " visible playlists appear on the wall.";
      note.className = "note";
      list.appendChild(el("li", "empty", "No playlists yet. Name one above to start."));
      return;
    }
    if (visible > MAX_CELLS) {
      note.textContent = visible + " playlists are set to show, but the wall fits " + MAX_CELLS +
        ". The highlighted ones are not displayed.";
      note.className = "note alert";
    } else {
      note.textContent = visible + " of " + MAX_CELLS + " wall cells in use.";
      note.className = "note";
    }

    var shown = 0;
    data.playlists.forEach(function (playlist, i) {
      var row = el("li", "row");
      if (playlist.id === selected) row.classList.add("selected");
      var onWall = playlist.visible !== false;
      if (onWall) { shown += 1; if (shown > MAX_CELLS) row.classList.add("over-cap"); }

      row.dataset.id = playlist.id;
      row.appendChild(el("span", "grab", onWall && shown <= MAX_CELLS ? shown + "." : "\u2013"));

      var name = el("input", "name");
      name.type = "text";
      name.value = playlist.name;
      name.maxLength = 120;
      // Selecting on focus must not redraw the list: that would tear out the
      // very input being typed into, which is what blocked renaming before.
      name.addEventListener("focus", function () {
        if (selected === playlist.id) return;
        selected = playlist.id;
        highlight();
        drawItems();
        drawLibrary();
      });
      name.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); name.blur(); }
        if (e.key === "Escape") { name.value = playlist.name; name.blur(); }
      });
      name.addEventListener("change", function () {
        var value = name.value.trim();
        if (!value || value === playlist.name) { name.value = playlist.name; return; }
        playlist.name = value;
        touched(playlist.id);
      });
      row.appendChild(name);

      row.appendChild(el("span", "meta",
        playlist.videos.length + (playlist.videos.length === 1 ? " video" : " videos")));

      var toggle = el("label", "toggle");
      var box = document.createElement("input");
      box.type = "checkbox";
      box.checked = onWall;
      box.addEventListener("change", function () { playlist.visible = box.checked; touched(); });
      toggle.appendChild(box);
      toggle.appendChild(document.createTextNode("Show"));
      row.appendChild(toggle);

      row.appendChild(arrows(i > 0, i < data.playlists.length - 1,
        function () { move(data.playlists, i, i - 1); touched(); },
        function () { move(data.playlists, i, i + 1); touched(); }));

      var del = el("button", "tiny danger", "Delete");
      del.type = "button";
      del.addEventListener("click", function () {
        if (!confirm('Delete "' + playlist.name + '"? The files on Bunny are untouched.')) return;
        data.playlists.splice(i, 1);
        if (selected === playlist.id) selected = null;
        touched();
      });
      row.appendChild(del);

      row.addEventListener("click", function (e) {
        if (e.target === row || e.target.classList.contains("grab")) {
          selected = playlist.id;
          draw();
        }
      });

      // A library file dropped on a playlist row joins that playlist,
      // whether or not it is the one being edited.
      dropTarget(row, function (src) { add(playlist, src); });

      list.appendChild(row);
    });
  }

  // Repaint the selected marker in place, leaving the rows and their inputs be.
  function highlight() {
    var rows = $("playlists").querySelectorAll(".row");
    Array.prototype.forEach.call(rows, function (row) {
      row.classList.toggle("selected", row.dataset.id === selected);
    });
  }

  function current() {
    return data.playlists.filter(function (p) { return p.id === selected; })[0] || null;
  }

  function drawItems() {
    var list = $("items");
    var playlist = current();
    list.innerHTML = "";
    $("contents-tools").hidden = !playlist;

    if (!playlist) {
      $("contents-hint").textContent = "Select a playlist to arrange its videos.";
      return;
    }
    $("contents-hint").textContent =
      "Videos in \u201c" + playlist.name + "\u201d play in this order, then loop. " +
      "Drag files here from the library.";

    if (!playlist.videos.length) {
      list.appendChild(el("li", "empty", "Empty. Drag a file in from the library, or use the manual field."));
      return;
    }

    playlist.videos.forEach(function (video, i) {
      var row = el("li", "row");
      row.appendChild(el("span", "grab", (i + 1) + "."));
      row.appendChild(thumbNode(video.src, true));

      var text = el("span", "pick", video.name || video.src);
      text.title = video.src;
      row.appendChild(text);

      var clash = holderOf(video.src, video);
      if (clash) {
        var warn = el("span", "meta flag",
          clash === playlist ? "duplicate" : "also in " + clash.name);
        warn.title = "Each file should appear once across the whole wall.";
        row.appendChild(warn);
      }

      var open = document.createElement("a");
      open.className = "meta";
      open.href = publicUrl(video.src);
      open.target = "_blank";
      open.rel = "noopener";
      open.textContent = "test";
      open.title = "Open the file directly to confirm the URL works";
      row.appendChild(open);

      row.appendChild(arrows(i > 0, i < playlist.videos.length - 1,
        function () { move(playlist.videos, i, i - 1); touched(); },
        function () { move(playlist.videos, i, i + 1); touched(); }));

      var del = el("button", "tiny danger", "Remove");
      del.type = "button";
      del.addEventListener("click", function () { playlist.videos.splice(i, 1); touched(); });
      row.appendChild(del);
      list.appendChild(row);
    });
  }

  function publicUrl(src) {
    return /^https?:\/\//i.test(src)
      ? src
      : (data.mediaBase || "").replace(/\/+$/, "") + "/" + String(src).replace(/^\/+/, "");
  }

  // -------------------------------------------------------- thumbnails

  // A frame is taken from the file itself, drawn to a canvas and kept as a
  // small JPEG in this browser, so a file is only ever fetched once. That
  // needs the pull zone to send CORS headers for video extensions; without
  // them the canvas is tainted and the grab is refused, so the pane falls
  // back to a muted <video> parked on its opening frame, which looks the
  // same but is fetched afresh on every load.
  var THUMB_W = 160, THUMB_H = 90;
  var THUMB_CAP = 600;          // cached frames, to stay inside localStorage
  var THUMB_PAR = 3;            // files decoded at once

  var thumbs = {};
  var thumbOn = true;
  var thumbCors = true;
  var thumbQueue = [];
  var thumbBusy = 0;
  var watcher = null;
  var thumbWrite = null;

  function saveThumbs() {
    clearTimeout(thumbWrite);
    thumbWrite = setTimeout(function () {
      try { localStorage.setItem(STORE + ":thumbs", JSON.stringify(thumbs)); }
      catch (e) { thumbs = {}; }   // quota: start again rather than half-write
      countThumbs();
    }, 400);
  }

  function countThumbs() {
    var n = Object.keys(thumbs).length;
    $("thumb-note").textContent = n ? n + " cached" : "";
  }

  function image(url) {
    var img = document.createElement("img");
    img.src = url;
    img.alt = "";
    img.loading = "lazy";
    return img;
  }

  // The no-canvas fallback: the browser paints the frame, nothing is stored.
  function liveFrame(src) {
    var v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "metadata";
    v.setAttribute("aria-hidden", "true");
    v.src = publicUrl(src) + (/#t=/.test(src) ? "" : "#t=0.4");
    return v;
  }

  function thumbNode(src, small) {
    var box = el("div", small ? "thumb small" : "thumb");
    if (!thumbOn) { box.classList.add("off"); return box; }
    if (thumbs[src]) { box.appendChild(image(thumbs[src])); return box; }
    if (!thumbCors) { box.appendChild(liveFrame(src)); return box; }
    box.classList.add("waiting");
    if (!window.IntersectionObserver) { enqueue(box, src); return box; }
    box._src = src;
    observer().observe(box);
    return box;
  }

  // Only rows that come near the viewport are decoded, so a zone with three
  // hundred files does not pull three hundred headers on load.
  function observer() {
    if (watcher) return watcher;
    watcher = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        watcher.unobserve(entry.target);
        enqueue(entry.target, entry.target._src);
      });
    }, { rootMargin: "300px" });
    return watcher;
  }

  function enqueue(box, src) {
    thumbQueue.push({ box: box, src: src });
    pump();
  }

  function release() {
    thumbBusy -= 1;
    pump();
  }

  function pump() {
    while (thumbBusy < THUMB_PAR && thumbQueue.length) {
      var job = thumbQueue.shift();
      if (!job.box.isConnected || !job.src) continue;
      if (thumbs[job.src]) { fill(job.box, thumbs[job.src]); continue; }
      thumbBusy += 1;
      grab(job.src, job.box);
    }
  }

  function fill(box, url) {
    box.classList.remove("waiting");
    box.innerHTML = "";
    box.appendChild(image(url));
  }

  function grab(src, box) {
    capture(src, thumbCors, function (url) {
      if (Object.keys(thumbs).length < THUMB_CAP) { thumbs[src] = url; saveThumbs(); }
      fill(box, url);
      release();
    }, function () {
      if (!thumbCors) { dead(box); release(); return; }
      // Second opinion without the CORS request. If the file loads that way,
      // the pull zone simply is not sending the header for this extension,
      // which is a setting rather than a broken file.
      probe(src, function (ok) {
        if (!ok) { dead(box); release(); return; }
        thumbCors = false;
        settings({ thumbcors: "no" });
        thumbQueue = [];
        say("The pull zone sends no CORS header for these files, so frames cannot be cached. " +
            "Showing live first frames instead. Add mp4 under Pull Zone \u203a Headers \u203a CORS to fix it.", true);
        release();
        draw();
      });
    });
  }

  function dead(box) {
    box.classList.remove("waiting");
    box.classList.add("bad");
    box.title = "Could not read a frame from this file";
  }

  function capture(src, useCors, done, fail) {
    var v = document.createElement("video");
    if (useCors) v.crossOrigin = "anonymous";
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";

    var settled = false;
    var timer = setTimeout(function () { bail(); }, 20000);

    function stop() {
      clearTimeout(timer);
      v.removeAttribute("src");
      try { v.load(); } catch (e) {}
    }
    function bail() { if (settled) return; settled = true; stop(); fail(); }

    v.addEventListener("loadedmetadata", function () {
      // A quarter of the way in, capped at a second, so a title card or a
      // black opening frame is not what ends up in the list.
      var at = Math.min(1, (v.duration || 4) * 0.25);
      try { v.currentTime = isFinite(at) ? at : 0; } catch (e) { bail(); }
    });

    v.addEventListener("seeked", function () {
      if (settled) return;
      var canvas = document.createElement("canvas");
      canvas.width = THUMB_W;
      canvas.height = THUMB_H;
      try {
        var ctx = canvas.getContext("2d");
        var vw = v.videoWidth || THUMB_W, vh = v.videoHeight || THUMB_H;
        // Centre crop, so a portrait clip fills the box rather than squashing.
        var scale = Math.max(THUMB_W / vw, THUMB_H / vh);
        var sw = THUMB_W / scale, sh = THUMB_H / scale;
        ctx.drawImage(v, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, THUMB_W, THUMB_H);
        var url = canvas.toDataURL("image/jpeg", 0.6);
        settled = true;
        stop();
        done(url);
      } catch (e) { bail(); }        // tainted canvas
    });

    v.addEventListener("error", bail);
    v.src = publicUrl(src);
    v.load();
  }

  // Does the file load at all when nothing is asked of CORS?
  function probe(src, cb) {
    var v = document.createElement("video");
    v.muted = true;
    v.preload = "metadata";
    var settled = false;
    var timer = setTimeout(function () { finish(false); }, 12000);
    function finish(ok) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      v.removeAttribute("src");
      try { v.load(); } catch (e) {}
      cb(ok);
    }
    v.addEventListener("loadedmetadata", function () { finish(true); });
    v.addEventListener("error", function () { finish(false); });
    v.src = publicUrl(src);
    v.load();
  }

  $("lib-thumbs").addEventListener("change", function () {
    thumbOn = $("lib-thumbs").checked;
    settings({ thumbon: thumbOn ? "yes" : "no" });
    thumbQueue = [];
    draw();
  });

  $("thumb-clear").addEventListener("click", function () {
    thumbs = {};
    try { localStorage.removeItem(STORE + ":thumbs"); } catch (e) {}
    thumbCors = true;
    settings({ thumbcors: "yes" });
    countThumbs();
    draw();
  });

  // ------------------------------------------------------- drag and drop

  var MIME = "application/x-wall-src";

  function dropTarget(node, drop) {
    node.addEventListener("dragover", function (e) {
      if (!dragging) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      node.classList.add("drop-on");
    });
    node.addEventListener("dragleave", function () { node.classList.remove("drop-on"); });
    node.addEventListener("drop", function (e) {
      e.preventDefault();
      node.classList.remove("drop-on");
      var src = e.dataTransfer.getData(MIME) || e.dataTransfer.getData("text/plain") || dragging;
      if (src) drop(src);
    });
  }

  // The contents pane takes drops for whichever playlist is open.
  dropTarget($("items"), function (src) {
    var playlist = current();
    if (!playlist) { say("Select a playlist first.", true); return; }
    add(playlist, src);
  });

  function add(playlist, src) {
    src = String(src || "").trim();
    if (!src) return;
    var clash = holderOf(src);
    if (clash) {
      say(clash === playlist
        ? "That file is already in this playlist."
        : "That file is already in \u201c" + clash.name + "\u201d. Each video belongs to one playlist.", true);
      return;
    }
    playlist.videos.push({ src: src, name: src.split("/").pop() });
    touched();
  }

  // ------------------------------------------------------- bunny library

  function storageHost(region) {
    return (region ? region + "." : "") + "storage.bunnycdn.com";
  }

  function encodePath(path) {
    return String(path).split("/").filter(Boolean).map(encodeURIComponent).join("/");
  }

  function listDir(zone, pass, region, path) {
    var url = "https://" + storageHost(region) + "/" + encodeURIComponent(zone) + "/" +
      (path ? encodePath(path) + "/" : "");
    return fetch(url, { headers: { AccessKey: pass }, cache: "no-store" })
      .then(function (r) {
        if (r.status === 401) throw new Error("the storage password was refused");
        if (r.status === 404) throw new Error("no such storage zone or folder");
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      });
  }

  // Depth-limited walk. Folders are visited one after another rather than all
  // at once, so a large zone does not open a hundred sockets.
  function walk(zone, pass, region, path, depth, out) {
    return listDir(zone, pass, region, path).then(function (entries) {
      var folders = [];
      (entries || []).forEach(function (e) {
        var rel = (path ? path + "/" : "") + e.ObjectName;
        if (e.IsDirectory) { if (depth > 0) folders.push(rel); return; }
        if (out.length < LIB_MAX && VIDEO.test(e.ObjectName)) {
          out.push({ src: rel, size: e.Length, at: e.LastChanged });
        }
      });
      return folders.reduce(function (chain, folder) {
        return chain.then(function () {
          if (out.length >= LIB_MAX) return null;
          return walk(zone, pass, region, folder, depth - 1, out);
        });
      }, Promise.resolve());
    });
  }

  function loadLibrary(quiet) {
    var zone = $("sz-name").value.trim();
    var pass = $("sz-key").value.trim();
    var region = $("sz-region").value;

    if (!zone || !pass) {
      if (!quiet) say("Set the storage zone name and password in Settings.", true);
      return;
    }
    settings({ szone: zone, sregion: region, skey: pass });

    var button = $("lib-refresh");
    button.disabled = true;
    $("lib-note").textContent = "Reading the storage zone\u2026";
    $("lib-note").className = "note";

    var found = [];
    walk(zone, pass, region, "", LIB_DEPTH, found)
      .then(function () {
        found.sort(function (a, b) { return a.src.localeCompare(b.src); });
        library = found;
        try { localStorage.setItem(STORE + ":lib", JSON.stringify(library)); } catch (e) {}
        drawLibrary();
      })
      .catch(function (err) {
        // A TypeError here is the browser refusing the response, which on this
        // endpoint means no CORS headers came back rather than a bad password.
        var blocked = err instanceof TypeError;
        $("lib-note").className = "note alert";
        $("lib-note").textContent = blocked
          ? "The browser blocked the request to storage.bunnycdn.com before any response arrived. That is a CORS refusal, not a wrong password. Paths can still be typed in by hand."
          : "Could not list the zone: " + err.message + ".";
        if (!quiet) say("Storage listing failed.", true);
      })
      .then(function () { button.disabled = false; });
  }

  function drawLibrary() {
    var list = $("library");
    var note = $("lib-note");
    var find = $("lib-find").value.trim().toLowerCase();
    list.innerHTML = "";

    if (!library.length) {
      if (!/blocked|Could not/.test(note.textContent)) {
        note.className = "note";
        note.textContent = $("sz-name").value.trim()
          ? "No video files listed yet. Press Refresh."
          : "Add your storage zone details in Settings to list the files here.";
      }
      return;
    }

    var playlist = current();
    var hideUsed = $("lib-unused").checked;
    var placed = 0;

    // Two filters, one pass: the name box, and the switch that drops every
    // file already sitting in a playlist so only the unplaced ones are left.
    var rows = library.filter(function (f) {
      if (find && f.src.toLowerCase().indexOf(find) === -1) return false;
      if (holderOf(f.src)) { placed += 1; return !hideUsed; }
      return true;
    });

    note.className = "note";
    note.textContent = rows.length + " of " + library.length + " file" +
      (library.length === 1 ? "" : "s") +
      (hideUsed && placed ? ", " + placed + " hidden as placed" : "") +
      (playlist ? ". Drag onto a playlist, or press +." : ". Select a playlist to add files.");

    if (!rows.length) {
      list.appendChild(el("li", "empty", hideUsed && placed
        ? "Every matching file is already on the wall."
        : "Nothing matches that filter."));
      return;
    }

    rows.forEach(function (file) {
      var holder = holderOf(file.src);
      var row = el("li", "row lib-row");
      if (holder) row.classList.add("used");
      row.draggable = true;
      row.dataset.src = file.src;

      row.addEventListener("dragstart", function (e) {
        dragging = file.src;
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData(MIME, file.src);
        e.dataTransfer.setData("text/plain", file.src);
        row.classList.add("lifting");
      });
      row.addEventListener("dragend", function () {
        dragging = null;
        row.classList.remove("lifting");
      });

      row.appendChild(el("span", "grab", "\u2237"));
      row.appendChild(thumbNode(file.src, false));

      var text = el("span", "pick", file.src);
      text.title = file.src + (file.size ? "  \u00b7  " + size(file.size) : "");
      row.appendChild(text);

      row.appendChild(el("span", "meta", size(file.size)));

      if (holder) {
        var used = el("span", "meta flag", "in " + holder.name);
        used.title = "Already on the wall. A file belongs to one playlist only.";
        row.appendChild(used);
      }

      var open = document.createElement("a");
      open.className = "meta";
      open.href = publicUrl(file.src);
      open.target = "_blank";
      open.rel = "noopener";
      open.textContent = "test";
      row.appendChild(open);

      var go = el("button", "tiny", "+");
      go.type = "button";
      go.title = playlist ? "Add to " + playlist.name : "Select a playlist first";
      go.disabled = !playlist || !!holder;
      go.addEventListener("click", function () { if (playlist) add(playlist, file.src); });
      row.appendChild(go);

      list.appendChild(row);
    });
  }

  $("lib-refresh").addEventListener("click", function () { loadLibrary(false); });
  $("sz-load").addEventListener("click", function () { loadLibrary(false); });
  $("lib-find").addEventListener("input", drawLibrary);
  $("lib-unused").addEventListener("change", function () {
    settings({ libunused: $("lib-unused").checked ? "yes" : "no" });
    drawLibrary();
  });
  $("sz-forget").addEventListener("click", function () {
    settings({ skey: "" });
    $("sz-key").value = "";
    say("Storage password cleared from this browser.");
  });

  // ------------------------------------------------------------- actions

  function addPlaylist() {
    var input = $("new-name");
    var name = input.value.trim();
    if (!name) { say("Give the playlist a name.", true); return; }
    var playlist = { id: uid(), name: name, visible: true, videos: [] };
    data.playlists.push(playlist);
    selected = playlist.id;
    input.value = "";
    touched();
  }

  $("new-go").addEventListener("click", addPlaylist);
  $("new-name").addEventListener("keydown", function (e) { if (e.key === "Enter") addPlaylist(); });

  function addVideo() {
    var playlist = current();
    var src = $("v-src").value.trim();
    if (!playlist || !src) { say("Enter the file path on Bunny.", true); return; }
    var clash = holderOf(src);
    if (clash) {
      say(clash === playlist
        ? "That file is already in this playlist."
        : "That file is already in \u201c" + clash.name + "\u201d. Each video belongs to one playlist.", true);
      return;
    }
    playlist.videos.push({ src: src, name: $("v-name").value.trim() || src.split("/").pop() });
    $("v-src").value = "";
    $("v-name").value = "";
    touched();
  }

  $("v-go").addEventListener("click", addVideo);
  $("v-name").addEventListener("keydown", function (e) { if (e.key === "Enter") addVideo(); });
  $("v-src").addEventListener("keydown", function (e) { if (e.key === "Enter") $("v-name").focus(); });

  $("media-base").addEventListener("change", function () {
    data.mediaBase = $("media-base").value.trim();
    touched();
  });

  // ---------------------------------------------------------- publishing

  function utf8Base64(text) {
    var bytes = new TextEncoder().encode(text);
    var binary = "";
    bytes.forEach(function (b) { binary += String.fromCharCode(b); });
    return btoa(binary);
  }

  function serialise() {
    return JSON.stringify({
      mediaBase: data.mediaBase,
      playlists: data.playlists
    }, null, 2) + "\n";
  }

  $("download").addEventListener("click", function () {
    var blob = new Blob([serialise()], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = FILE;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $("forget").addEventListener("click", function () {
    settings({ token: "" });
    $("gh-token").value = "";
    say("Token cleared from this browser.");
  });

  $("publish").addEventListener("click", function () {
    var owner = $("gh-owner").value.trim();
    var repo = $("gh-repo").value.trim();
    var branch = $("gh-branch").value.trim() || "main";
    var token = $("gh-token").value.trim();

    if (!owner || !repo || !token) {
      drawer(true);
      say("Owner, repository and token are all required.", true);
      return;
    }
    settings({ owner: owner, repo: repo, branch: branch, token: token });

    var button = $("publish");
    button.disabled = true;
    button.textContent = "Publishing";

    var api = "https://api.github.com/repos/" + owner + "/" + repo + "/contents/" + FILE;
    var headers = { Authorization: "Bearer " + token, Accept: "application/vnd.github+json" };

    var payload = utf8Base64(serialise());
    var retried = false;

    // The API needs the current blob sha to replace an existing file. The read
    // is uncached: a revalidated response carries the sha from before the last
    // publish, and GitHub then rejects the write as a conflict.
    function currentSha() {
      return fetch(api + "?ref=" + encodeURIComponent(branch) + "&t=" + Date.now(),
                   { headers: headers, cache: "no-store" })
        .then(function (r) {
          if (r.status === 404) return null;          // the file is not there yet
          if (!r.ok) return r.json().then(function (e) { throw new Error(e.message || r.status); });
          return r.json().then(function (j) { return j.sha; });
        });
    }

    function put(sha) {
      var body = { message: "Update wall playlists", content: payload, branch: branch };
      if (sha) body.sha = sha;
      return fetch(api, {
        method: "PUT",
        headers: Object.assign({ "Content-Type": "application/json" }, headers),
        body: JSON.stringify(body)
      }).then(function (r) {
        return r.json().then(function (j) {
          // 409 means the sha was stale. Read it again and make one more attempt.
          if (r.status === 409 && !retried) { retried = true; return currentSha().then(put); }
          if (!r.ok) throw new Error(j.message || "HTTP " + r.status);
          return j;
        });
      });
    }

    currentSha()
      .then(put)
      .then(function () {
        dirty = false;
        say("Published. GitHub Pages usually rebuilds within a minute.");
        $("publish-note").textContent = "published";
        $("publish-note").className = "meta";
      })
      .catch(function (err) {
        say("Publish failed: " + err.message, true);
      })
      .then(function () {
        button.disabled = false;
        button.textContent = "Publish";
      });
  });

  window.addEventListener("beforeunload", function (e) {
    if (dirty) { e.preventDefault(); e.returnValue = ""; }
  });

  // ---------------------------------------------------------------- boot

  function guessRepo() {
    var host = location.hostname;                       // user.github.io
    var parts = location.pathname.split("/").filter(Boolean);
    var owner = host.endsWith(".github.io") ? host.replace(".github.io", "") : "";
    var repo = owner && parts.length ? parts[0] : (owner ? host : "");
    return { owner: owner, repo: repo };
  }

  function boot(live) {
    var draft = null;
    try { draft = JSON.parse(localStorage.getItem(STORE + ":draft") || "null"); } catch (e) {}

    if (draft && live && JSON.stringify(draft) !== JSON.stringify(live)) {
      if (confirm("This browser has unpublished changes. Keep them?\n\nCancel loads the published version instead.")) {
        data = draft;
        dirty = true;
      } else {
        data = live;
        localStorage.removeItem(STORE + ":draft");
      }
    } else {
      data = live || draft || data;
    }

    data.playlists = data.playlists || [];
    data.playlists.forEach(function (p) {
      if (!p.id) p.id = uid();
      p.videos = p.videos || [];
    });

    $("media-base").value = data.mediaBase || "";
    delete data.previews;

    var saved = settings();
    var guess = guessRepo();
    $("gh-owner").value = saved.owner || guess.owner;
    $("gh-repo").value = saved.repo || guess.repo;
    $("gh-branch").value = saved.branch || "main";
    $("gh-token").value = saved.token || "";

    $("sz-name").value = saved.szone || "";
    $("sz-region").value = saved.sregion || "";
    $("sz-key").value = saved.skey || "";

    $("lib-unused").checked = saved.libunused === "yes";

    thumbOn = saved.thumbon !== "no";
    thumbCors = saved.thumbcors !== "no";
    $("lib-thumbs").checked = thumbOn;
    try { thumbs = JSON.parse(localStorage.getItem(STORE + ":thumbs") || "{}"); } catch (e) { thumbs = {}; }
    countThumbs();

    // The last listing is kept so the pane is populated on load without
    // going back to Bunny. Refresh re-reads the zone.
    try { library = JSON.parse(localStorage.getItem(STORE + ":lib") || "[]"); } catch (e) { library = []; }

    try { drawer(!!localStorage.getItem(STORE + ":settings-open")); } catch (e) {}

    var counts = {}, repeats = 0;
    data.playlists.forEach(function (p) {
      p.videos.forEach(function (v) {
        var k = key(v.src);
        counts[k] = (counts[k] || 0) + 1;
        if (counts[k] === 2) repeats += 1;
      });
    });
    if (repeats) {
      say(repeats + (repeats === 1 ? " file appears" : " files appear") +
        " more than once. They are flagged in the contents pane.", true);
    }

    $("publish-note").textContent = dirty ? "unpublished changes" : "";
    $("publish-note").className = dirty ? "meta alert" : "meta";

    draw();

    // A saved password means the zone was browsable last time, so refresh
    // quietly in the background rather than showing a stale list.
    if (saved.szone && saved.skey) loadLibrary(true);
  }

  fetch(FILE + "?v=" + Date.now(), { cache: "no-store" })
    .then(function (r) { return r.ok ? r.json() : null; })
    .catch(function () { return null; })
    .then(boot);
})();