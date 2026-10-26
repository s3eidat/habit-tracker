/* Habit Tracker — habits live in localStorage (S3.store). Dates are local calendar days (YYYY-MM-DD). */
(function () {
  "use strict";
  var $ = S3.$, $$ = S3.$$, h = S3.h;
  var KEY = "habits.data";
  var COLORS = ["#2bb3ad", "#4c8dff", "#a26bf5", "#ec5f9e", "#ef5b5b", "#f59340", "#e0b52f", "#3fbf77"];
  var EMOJIS = ["💧", "📚", "🏃", "🧘", "🥗", "💤", "✍️", "🦷", "💊", "🎸", "🙏", "📵"];
  var habits = [], weekStart = 1, offset = 0, pickedColor = COLORS[0], openId = "";

  // ---------- dates & stats (pure, tested) ----------
  function iso(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function parseISO(s) { var p = s.split("-"); return new Date(+p[0], p[1] - 1, +p[2]); }
  function shift(s, n) { var d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); }
  function diff(a, b) { return Math.round((parseISO(a) - parseISO(b)) / 864e5); }
  function isoDow(s) { return parseISO(s).getDay() || 7; } // Mon=1 … Sun=7
  // 7 dates of the week containing `today` (+offset weeks), starting on startDow (1=Mon, 6=Sat, 7=Sun).
  function weekDays(today, startDow, off) {
    var back = (isoDow(today) - startDow + 7) % 7, first = shift(today, -back + 7 * (off || 0)), out = [];
    for (var i = 0; i < 7; i++) out.push(shift(first, i));
    return out;
  }
  // Current streak: consecutive days ending today, or ending yesterday if today isn't ticked yet.
  function currentStreak(days, today) {
    var d = days[today] ? today : shift(today, -1), n = 0;
    while (days[d]) { n++; d = shift(d, -1); }
    return n;
  }
  function bestStreak(days) {
    var ks = Object.keys(days).sort(), best = 0, run = 0;
    ks.forEach(function (k, i) { run = i && diff(k, ks[i - 1]) === 1 ? run + 1 : 1; if (run > best) best = run; });
    return best;
  }
  // Share of the last 30 days that were ticked, counting only days since the habit started.
  function pct30(days, today, created) {
    var first = Object.keys(days).sort()[0], start = first && first < created ? first : created;
    var n = Math.max(1, Math.min(30, diff(today, start) + 1)), done = 0;
    for (var i = 0; i < n; i++) if (days[shift(today, -i)]) done++;
    return Math.round(done / n * 100);
  }
  function heatDates(today, startDow) {
    var first = weekDays(today, startDow, -52)[0], last = weekDays(today, startDow, 0)[6], out = [];
    for (var d = first; d <= last; d = shift(d, 1)) out.push(d);
    return out;
  }

  // ---------- untrusted data ----------
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function clean(list) {
    var seen = {}, t = iso(new Date());
    return (Array.isArray(list) ? list : []).slice(0, 200).map(function (o) {
      o = o && typeof o === "object" ? o : {};
      var id = typeof o.id === "string" && /^[a-z0-9]{1,24}$/i.test(o.id) && !seen[o.id] ? o.id : uid(); seen[id] = 1;
      var days = {};
      (Array.isArray(o.done) ? o.done : []).slice(0, 40000).sort().forEach(function (d) { if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && iso(parseISO(d)) === d) days[d] = true; });
      return {
        id: id, name: typeof o.name === "string" && o.name.trim() ? o.name.trim().slice(0, 60) : "Habit",
        emoji: typeof o.emoji === "string" ? Array.from(o.emoji.trim()).slice(0, 3).join("") : "",
        color: COLORS.indexOf(o.color) >= 0 ? o.color : COLORS[0],
        created: typeof o.created === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.created) ? o.created : t,
        archived: o.archived === true, days: days
      };
    });
  }
  function serial() {
    return habits.map(function (x) { return { id: x.id, name: x.name, emoji: x.emoji, color: x.color, created: x.created, archived: x.archived, done: Object.keys(x.days).sort() }; });
  }
  function persist() {
    if (S3.store(KEY, { habits: serial(), weekStart: weekStart }) === undefined) S3.toast("Couldn't save — export your habits to keep them safe", "error");
  }

  // ---------- render ----------
  function today() { return iso(new Date()); }
  function fmt(s, o) { return parseISO(s).toLocaleDateString("en-GB", o); }
  function active() { return habits.filter(function (x) { return !x.archived; }); }
  function heatmap(x, t) {
    var dates = heatDates(t, weekStart), wrap = h("div", { "class": "heat-wrap" }), grid = h("div", { "class": "heat", role: "img" }), total = 0;
    grid.style.setProperty("--c", x.color);
    dates.forEach(function (d) {
      var on = !!x.days[d]; if (on) total++;
      grid.appendChild(h("i", { "class": (on ? "on" : "") + (d > t ? " fut" : "") + (d === t ? " now" : ""), title: fmt(d, { weekday: "short", day: "numeric", month: "short", year: "numeric" }) + (on ? " ✓" : "") }));
    });
    grid.setAttribute("aria-label", x.name + ": " + total + " check-ins in the last year");
    wrap.appendChild(grid);
    return h("div", { "class": "heat-box" }, [wrap, h("div", { "class": "faint", text: total + " check-ins in the last 12 months · best streak " + bestStreak(x.days) + " days" })]);
  }
  function render() {
    var t = today(), wk = weekDays(t, weekStart, offset), list = active(), grid = $("#grid");
    $("#weekLabel").textContent = offset === 0 ? "This week" : fmt(wk[0], { day: "numeric", month: "short" }) + " – " + fmt(wk[6], { day: "numeric", month: "short", year: "numeric" });
    $("#next").disabled = offset >= 0; $("#thisWeek").hidden = offset === 0;
    $$("#start button").forEach(function (b) { b.setAttribute("aria-pressed", String(+b.dataset.v === weekStart)); });
    grid.textContent = "";
    if (!list.length) grid.appendChild(h("div", { "class": "empty" }, [h("b", { text: "No habits yet" }), "Add one above — small and specific works best."]));
    else grid.appendChild(h("div", { "class": "hrow head" }, [h("span", { "class": "h-name" })].concat(wk.map(function (d) {
      return h("span", { "class": "day" + (d === t ? " now" : "") }, [h("b", { text: fmt(d, { weekday: "short" }) }), h("span", { text: fmt(d, { day: "numeric" }) })]);
    }), [h("span", { "class": "h-stats faint", text: "streak · 30d" }), h("span")])));
    list.forEach(function (x, i) {
      var cur = currentStreak(x.days, t);
      var row = h("div", { "class": "hrow", "data-id": x.id }, [
        h("button", { "class": "h-name", "data-heat": x.id, "aria-expanded": String(openId === x.id), title: "Show year heatmap" }, [
          h("span", { "class": "h-emoji", text: x.emoji || "•" }), h("span", { "class": "h-title", dir: "auto", text: x.name })
        ])
      ].concat(wk.map(function (d) {
        var on = !!x.days[d];
        return h("button", { "class": "cell" + (on ? " on" : "") + (d === t ? " now" : ""), "data-day": d, disabled: d > t, "aria-pressed": String(on),
          "aria-label": x.name + ", " + fmt(d, { weekday: "long", day: "numeric", month: "long" }), html: on ? S3.icon("check") : "" });
      }), [
        h("span", { "class": "h-stats" }, [h("b", { "class": cur ? "fire" : "", text: (cur ? "🔥 " : "") + cur }), h("span", { "class": "faint", text: pct30(x.days, t, x.created) + "%" })]),
        h("span", { "class": "h-act" }, [
          h("button", { "class": "btn ghost icon small", "data-move": "-1", disabled: i === 0, "aria-label": "Move " + x.name + " up", text: "↑" }),
          h("button", { "class": "btn ghost icon small", "data-move": "1", disabled: i === list.length - 1, "aria-label": "Move " + x.name + " down", text: "↓" }),
          h("button", { "class": "btn ghost small", "data-arch": "", "aria-label": "Archive " + x.name, text: "Archive" })
        ])
      ]));
      row.style.setProperty("--c", x.color);
      grid.appendChild(row);
      if (openId === x.id) { grid.appendChild(heatmap(x, t)); var w = $(".heat-wrap", grid); if (w) w.scrollLeft = w.scrollWidth; }
    });
    // Overall stats for the visible week
    var cells = 0, ticked = 0;
    list.forEach(function (x) { wk.forEach(function (d) { if (d <= t) { cells++; if (x.days[d]) ticked++; } }); });
    var todayDone = list.filter(function (x) { return x.days[t]; }).length;
    $("#stats").innerHTML = "";
    if (list.length) [["Done today", todayDone + " / " + list.length], ["This week", cells ? Math.round(ticked / cells * 100) + "%" : "—"],
      ["Longest current streak", Math.max.apply(null, list.map(function (x) { return currentStreak(x.days, t); })) + " days"]].forEach(function (s) {
      $("#stats").appendChild(h("div", { "class": "stat" }, [h("b", { text: s[1] }), h("span", { text: s[0] })]));
    });
    drawArchived();
  }
  function drawArchived() {
    var arch = habits.filter(function (x) { return x.archived; }), box = $("#archived");
    $("#archCount").textContent = arch.length ? "(" + arch.length + ")" : "(none)";
    box.textContent = "";
    if (!arch.length) box.appendChild(h("p", { "class": "faint", text: "Archived habits keep their history and can be restored any time." }));
    arch.forEach(function (x) {
      box.appendChild(h("div", { "class": "row arch", "data-id": x.id }, [
        h("span", { text: (x.emoji ? x.emoji + " " : "") + x.name }), h("span", { "class": "faint", text: Object.keys(x.days).length + " check-ins" }), h("span", { "class": "grow" }),
        h("button", { "class": "btn small", "data-restore": "", text: "Restore" }),
        h("button", { "class": "btn ghost small danger", "data-delete": "", html: S3.icon("trash") + "Delete" })
      ]));
    });
  }

  // ---------- events ----------
  function byId(id) { return habits.filter(function (x) { return x.id === id; })[0]; }
  function add() {
    var name = $("#name").value.trim(); if (!name) { $("#name").focus(); return; }
    habits.push(clean([{ name: name, emoji: $("#emoji").value, color: pickedColor }])[0]);
    $("#name").value = ""; persist(); render();
    pickedColor = COLORS[(COLORS.indexOf(pickedColor) + 1) % COLORS.length]; drawColors();
  }
  $("#add").addEventListener("click", add);
  $("#name").addEventListener("keydown", function (e) { if (e.key === "Enter") add(); });
  function drawColors() {
    var box = $("#colors"); box.textContent = "";
    COLORS.forEach(function (c) {
      var b = h("button", { "class": "sw", "data-c": c, "aria-pressed": String(c === pickedColor), "aria-label": "Colour " + c });
      b.style.background = c; box.appendChild(b);
    });
  }
  $("#colors").addEventListener("click", function (e) { var b = e.target.closest(".sw"); if (b) { pickedColor = b.dataset.c; drawColors(); } });
  EMOJIS.forEach(function (em) { $("#emojis").appendChild(h("button", { "class": "btn ghost icon small", "data-em": em, "aria-label": "Use " + em, text: em })); });
  $("#emojis").addEventListener("click", function (e) { var b = e.target.closest("[data-em]"); if (b) { $("#emoji").value = b.dataset.em; $("#name").focus(); } });

  $("#grid").addEventListener("click", function (e) {
    var row = e.target.closest(".hrow"), b = e.target.closest("button");
    if (!row || !b || b.disabled || !row.dataset.id) return;
    var x = byId(row.dataset.id), list = active();
    if (b.dataset.day) {
      if (x.days[b.dataset.day]) delete x.days[b.dataset.day]; else { x.days[b.dataset.day] = true; if (b.dataset.day === today()) S3.done(); }
    } else if (b.dataset.heat) openId = openId === x.id ? "" : x.id;
    else if (b.dataset.move) {
      var other = list[list.indexOf(x) + +b.dataset.move], i = habits.indexOf(x), j = habits.indexOf(other);
      habits[i] = other; habits[j] = x;
    } else if (b.hasAttribute("data-arch")) { x.archived = true; S3.toast("Archived “" + x.name + "” — restore it below"); }
    else return;
    persist(); render();
    var again = $(".hrow[data-id='" + x.id + "'] [data-day='" + b.dataset.day + "']") || $(".hrow[data-id='" + x.id + "'] [data-move='" + b.dataset.move + "']");
    if (again && !again.disabled) again.focus();
  });
  $("#archived").addEventListener("click", function (e) {
    var row = e.target.closest(".arch"); if (!row) return;
    var x = byId(row.dataset.id);
    if (e.target.closest("[data-restore]")) { x.archived = false; persist(); render(); }
    if (e.target.closest("[data-delete]")) {
      var at = habits.indexOf(x); habits.splice(at, 1); persist(); render();
      var t = S3.toast("Deleted “" + x.name + "” ");
      t.appendChild(h("button", { "class": "btn small", text: "Undo", onclick: function () { habits.splice(at, 0, x); persist(); render(); t.remove(); } }));
    }
  });
  $("#prev").addEventListener("click", function () { offset--; render(); });
  $("#next").addEventListener("click", function () { if (offset < 0) offset++; render(); });
  $("#thisWeek").addEventListener("click", function () { offset = 0; render(); });
  $$("#start button").forEach(function (b) { b.addEventListener("click", function () { weekStart = +b.dataset.v; persist(); render(); }); });
  $("#exp").addEventListener("click", function () {
    S3.download(JSON.stringify({ app: "s3-habit-tracker", version: 1, habits: serial() }, null, 2), "habits-backup.json", "application/json"); S3.done();
  });
  $("#imp input").addEventListener("change", function (e) {
    var f = e.target.files[0]; e.target.value = ""; if (!f) return;
    if (f.size > 20 * 1024 * 1024) { S3.toast("That file is too large", "error"); return; }
    S3.readFile(f, "text").then(function (t) {
      var d; try { d = JSON.parse(t); } catch (err) { S3.toast("Not valid JSON", "error"); return; }
      var raw = Array.isArray(d) ? d : d && Array.isArray(d.habits) ? d.habits : null;
      if (!raw || !raw.length) { S3.toast("No habits found in that file", "error"); return; }
      var merged = clean(serial().concat(raw)), added = merged.length - habits.length;
      habits = merged; persist(); render(); S3.toast("Imported " + added + " habit" + (added === 1 ? "" : "s")); S3.done();
    });
  });

  // ---------- boot ----------
  var stored = S3.store(KEY) || {};
  habits = clean(stored.habits);
  weekStart = [1, 6, 7].indexOf(stored.weekStart) >= 0 ? stored.weekStart : 1;
  drawColors(); render();

  window.S3_DEMO = function () {
    var t = today(), mk = function (seed, rate, len) {
      var out = [];
      for (var i = 0; i < len; i++) { var x = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453; if (x - Math.floor(x) < rate || i < 6) out.push(shift(t, -i)); }
      return out;
    };
    habits = clean([
      { name: "Drink 8 glasses of water", emoji: "💧", color: COLORS[1], created: shift(t, -200), done: mk(1, 0.82, 200) },
      { name: "Read 20 pages", emoji: "📚", color: COLORS[2], created: shift(t, -300), done: mk(2, 0.65, 300).filter(function (d) { return d !== t; }) },
      { name: "Morning run", emoji: "🏃", color: COLORS[5], created: shift(t, -120), done: mk(3, 0.45, 120).slice(3) },
      { name: "10 minutes meditation", emoji: "🧘", color: COLORS[0], created: shift(t, -365), done: mk(4, 0.7, 365) }
    ]);
    openId = habits[0].id; persist(); render();
  };

  window.S3_SELFTEST = function () {
    var days = {}; ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-24", "2026-10-25", "2026-10-26"].forEach(function (d) { days[d] = true; });
    var okS = currentStreak(days, "2026-10-26") === 3 && currentStreak(days, "2026-10-27") === 3 && currentStreak(days, "2026-10-28") === 0 &&
      currentStreak(days, "2026-10-22") === 3 && currentStreak({}, "2026-10-26") === 0 && bestStreak(days) === 3 && bestStreak({}) === 0;
    var long = {}; for (var i = 0; i < 40; i++) long[shift("2026-03-01", i)] = true; // crosses DST and Feb/Mar month ends
    var okL = bestStreak(long) === 40 && currentStreak(long, shift("2026-03-01", 39)) === 40 && currentStreak({ "2025-12-31": true, "2026-01-01": true }, "2026-01-01") === 2;
    var okP = pct30(days, "2026-10-26", "2026-10-20") === 86 && pct30({}, "2026-10-26", "2026-10-26") === 0 && pct30(long, shift("2026-03-01", 39), "2026-01-01") === 100 &&
      pct30({ "2026-10-10": true }, "2026-10-26", "2026-10-20") === 6; // a tick before "created" moves the start back: 1 of 17 days
    var w1 = weekDays("2026-10-26", 1, 0), w2 = weekDays("2026-10-26", 6, 0), w3 = weekDays("2026-10-26", 7, -1);
    var okW = w1[0] === "2026-10-26" && w1[6] === "2026-11-01" && w2[0] === "2026-10-24" && w2[6] === "2026-10-30" && w3[0] === "2026-10-18" && w3[6] === "2026-10-24";
    var hd = heatDates("2026-10-26", 1);
    var okH = hd.length === 371 && hd[0] === "2025-10-27" && hd[370] === "2026-11-01";
    var src = clean([{ name: "Read ✓", emoji: "📚", color: COLORS[2], created: "2026-01-01", archived: true, done: ["2026-01-02", "2026-01-01"] }]);
    var okR = JSON.stringify(clean(JSON.parse(JSON.stringify(src.map(function (x) { return { id: x.id, name: x.name, emoji: x.emoji, color: x.color, created: x.created, archived: x.archived, done: Object.keys(x.days).sort() }; }))))) === JSON.stringify(src);
    var bad = clean([{ name: "<b>", color: "url(x)", done: ["2026-02-30", "nope", 5, "2026-02-28"], created: "x", emoji: "🔥🔥🔥🔥🔥" }, 3]);
    var okB = bad.length === 2 && bad[0].color === COLORS[0] && Object.keys(bad[0].days).join() === "2026-02-28" && /^\d{4}/.test(bad[0].created) && Array.from(bad[0].emoji).length === 3 && bad[1].name === "Habit";
    return okS && okL && okP && okW && okH && okR && okB;
  };
})();
