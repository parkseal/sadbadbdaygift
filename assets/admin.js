(function () {
  "use strict";

  var MAX_CELLS = 9;
  var FILE = "playlists.json";
  var STORE = "wall-admin";

  var data = { mediaBase: "", playlists: [] };
  var selected = null;
  var dirty = false;

  var $ = function (id) { return document.getElementById(id); };

  // ------------------------------------------------------------- helpers

  function say(message, bad) {
    var toast = $("toast");
    toast.textContent = message;
    toast.className = bad ? "toast bad" : "toast";
    toast.hidden = false;
    clearTimeout(say.timer);
    say.timer = setTimeout(function () { toast.hidden = true; }, 4000);
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

  function touched(keepCaretIn) {
    dirty = true;
    $("publish-note").textContent = "Unpublished changes. They live in this browser until you publish.";
    $("publish-note").className = "note alert";
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

  // ------------------------------------------------------------- drawing

  function draw() {
    drawPlaylists();
    drawItems();
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
        if (e.target === row || e.target.classList.contains("grab")) { selected = playlist.id; draw(); }
      });
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
      "Videos in \u201c" + playlist.name + "\u201d play in this order, then loop.";

    if (!playlist.videos.length) {
      list.appendChild(el("li", "empty", "This playlist is empty, so its cell shows a placeholder."));
      return;
    }

    playlist.videos.forEach(function (video, i) {
      var row = el("li", "row");
      row.appendChild(el("span", "grab", (i + 1) + "."));

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
      open.href = /^https?:\/\//i.test(video.src)
        ? video.src
        : (data.mediaBase || "").replace(/\/+$/, "") + "/" + video.src.replace(/^\/+/, "");
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

    if (!owner || !repo || !token) { say("Owner, repository and token are all required.", true); return; }
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
        $("publish-note").textContent = "Published. Reload the wall in a minute to see it.";
        $("publish-note").className = "note";
      })
      .catch(function (err) {
        say("Publish failed: " + err.message, true);
      })
      .then(function () {
        button.disabled = false;
        button.textContent = "Publish to GitHub";
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

    if (dirty) {
      $("publish-note").textContent = "Unpublished changes. They live in this browser until you publish.";
      $("publish-note").className = "note alert";
    }
    draw();
  }

  fetch(FILE + "?v=" + Date.now(), { cache: "no-store" })
    .then(function (r) { return r.ok ? r.json() : null; })
    .catch(function () { return null; })
    .then(boot);
})();