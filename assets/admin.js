(function () {
  "use strict";

  var MAX_CELLS = 9;
  var FILE = "playlists.json";
  var STORE = "wall-admin";

  var data = { mediaBase: "", previews: "auto", playlists: [] };
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

  function touched() {
    dirty = true;
    $("publish-note").textContent = "Unpublished changes. They live in this browser until you publish.";
    $("publish-note").className = "note alert";
    saveLocal();
    draw();
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

      row.appendChild(el("span", "grab", onWall && shown <= MAX_CELLS ? shown + "." : "\u2013"));

      var name = el("input", "name");
      name.type = "text";
      name.value = playlist.name;
      name.maxLength = 120;
      name.addEventListener("focus", function () { selected = playlist.id; draw(); });
      name.addEventListener("change", function () {
        var value = name.value.trim();
        if (!value) { name.value = playlist.name; return; }
        playlist.name = value;
        touched();
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

    // Suggest paths already used elsewhere so they need not be retyped.
    var seen = {};
    data.playlists.forEach(function (p) {
      p.videos.forEach(function (v) { seen[v.src] = true; });
    });
    var dl = $("known-srcs");
    dl.innerHTML = "";
    Object.keys(seen).sort().forEach(function (src) {
      dl.appendChild(new Option(src));
    });

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
  $("previews").addEventListener("change", function () {
    data.previews = $("previews").value;
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
      previews: data.previews,
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

    // The API needs the current blob sha to replace an existing file.
    fetch(api + "?ref=" + encodeURIComponent(branch), { headers: headers })
      .then(function (r) {
        if (r.status === 404) return null;
        if (!r.ok) return r.json().then(function (e) { throw new Error(e.message || r.status); });
        return r.json().then(function (j) { return j.sha; });
      })
      .then(function (sha) {
        var body = {
          message: "Update wall playlists",
          content: utf8Base64(serialise()),
          branch: branch
        };
        if (sha) body.sha = sha;
        return fetch(api, {
          method: "PUT",
          headers: Object.assign({ "Content-Type": "application/json" }, headers),
          body: JSON.stringify(body)
        });
      })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error(j.message || "HTTP " + r.status);
          return j;
        });
      })
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
    $("previews").value = data.previews === "hover" ? "hover" : "auto";

    var saved = settings();
    var guess = guessRepo();
    $("gh-owner").value = saved.owner || guess.owner;
    $("gh-repo").value = saved.repo || guess.repo;
    $("gh-branch").value = saved.branch || "main";
    $("gh-token").value = saved.token || "";

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
