const BASE = "http://127.0.0.1:8787";
async function api(path, body) {
  const r = await fetch(BASE + path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}
const move = process.argv[2];
if (move) { try { await api("/api/race/move", { id: move }); } catch (e) { console.log("REJECTED " + move + " " + e.message); } }

const s = await api("/api/race");
const j = s.jev, m = s.me;
console.log(`JEV  块${j.pieces} 行${j.lines} 分${j.score} 洞${j.holes} 高${j.max} 凸${j.bumpiness} ${j.over ? "OVER" : ""}`);
console.log(`ME   块${m.pieces} 行${m.lines} 分${m.score} 洞${m.holes} 高${m.max} 凸${m.bumpiness} ${m.over ? "OVER " + m.reason : ""}`);
if (m.over) process.exit(0);
console.log(`piece=${m.piece} next=${m.next}`);
m.board.slice(13).forEach((row) => console.log("  " + row.map((c) => (c ? "#" : ".")).join("")));
console.log("  " + m.heights.join(""));
console.log("id      cl ho bu mx ag   heights");
for (const c of m.cands) console.log(`${c.id.padEnd(7)} ${String(c.cleared).padStart(2)} ${String(c.holes).padStart(2)} ${String(c.bumpiness).padStart(2)} ${String(c.max).padStart(2)} ${String(c.aggregate).padStart(3)}  ${c.heights.join("")}${c.id === m.autoId ? " *" : ""}`);
