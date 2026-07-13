import "./style.css";
import { BanyanGame, COLORS, type BotMode, type Settings } from "./engine";
import { continueTutorial, createTutorial, updateTutorial, type TutorialState } from "./tutorial";

const app = document.querySelector<HTMLDivElement>("#app")!;
const SQRT3 = Math.sqrt(3);
const defaultSettings = (): Settings => ({ size: 5, players: 2, obstacles: 0, pace: 1 / 3, bots: ["human", "human", "easy", "easy", "easy", "easy"] });
let settings = { ...defaultSettings(), bots: [...defaultSettings().bots] };
let game: BanyanGame | null = null;
let tutorial: TutorialState | null = null;
let screen: "home" | "custom" | "settings" | "help" | "game" = "home";
let selectedPlayer = 0;
let last = performance.now();
let floatingNotices: { x: number; y: number; text: string; expiresAt: number }[] = [];
let touchDirection = -1;
let touchPointer: { id: number; x: number; y: number; player: number } | null = null;
let nextHudUpdate = 0;
let toastTimer: number | undefined;
const audio = new Map<string, HTMLAudioElement>();
const sprites: Record<string, CanvasImageSource> = {};
for (const name of ["Fruit", "Pest", "SquareRoot", "Player", "Land", "edge", "node", "empty"]) {
  const image = new Image();
  sprites[name] = image;
  image.addEventListener("load", () => {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < pixels.data.length; i += 4) if (pixels.data[i] < 8 && pixels.data[i + 1] < 8 && pixels.data[i + 2] < 8) pixels.data[i + 3] = 0;
    context.putImageData(pixels, 0, 0);
    sprites[name] = canvas;
  }, { once: true });
  image.src = `/assets/${name === "Pest" ? "Pest.gif" : `${name}.png`}`;
}
type Control = { joystick: boolean; up: string; down: string; left: string; right: string; lUp: string; rUp: string; lDown: string; rDown: string; back: string; reinforce: string };
type BindingKey = Exclude<keyof Control, "joystick">;
const defaultControls: Control[] = [
  { joystick: true, up: "w", down: "s", left: "a", right: "d", lUp: "", rUp: "", lDown: "", rDown: "", back: "1", reinforce: "2" },
  { joystick: true, up: "arrowup", down: "arrowdown", left: "arrowleft", right: "arrowright", lUp: "", rUp: "", lDown: "", rDown: "", back: ",", reinforce: "." },
  { joystick: true, up: "t", down: "g", left: "f", right: "h", lUp: "", rUp: "", lDown: "", rDown: "", back: "4", reinforce: "5" },
  { joystick: true, up: "i", down: "k", left: "j", right: "l", lUp: "", rUp: "", lDown: "", rDown: "", back: "7", reinforce: "8" },
  { joystick: true, up: "", down: "", left: "", right: "", lUp: "", rUp: "", lDown: "", rDown: "", back: "", reinforce: "" },
  { joystick: true, up: "", down: "", left: "", right: "", lUp: "", rUp: "", lDown: "", rDown: "", back: "", reinforce: "" }
];
function loadControls(): Control[] { try { const saved = JSON.parse(localStorage.getItem("banyan-controls") ?? "null"); if (Array.isArray(saved) && saved.length === 6) return saved.map((item, index) => ({ ...defaultControls[index], ...item, joystick: item.joystick ?? true })); } catch { /* ignore malformed local data */ } return defaultControls.map(c => ({ ...c })); }
let controls = loadControls();
const heldKeys = new Set<string>();
let captureBinding: { player: number; field: BindingKey } | null = null;

function sound(name: string) { const path: Record<string, string> = { fruit: "fruit_gain", capture: "capture_root", return: "fast_return", reinforce: "reinforce", win: "end_game", error: "forced_return" }; const file = path[name]; if (!file) return; let a = audio.get(file); if (!a) { a = new Audio(`/assets/${file}.ogg`); a.volume = Number(localStorage.getItem("banyan-sfx") ?? .3); audio.set(file, a); } a.currentTime = 0; a.play().catch(() => undefined); }
function music(track: "alpha" | "infinite_amethyst") { let a = audio.get(track); if (!a) { a = new Audio(`/assets/${track}.ogg`); a.loop = true; audio.set(track, a); } a.volume = Number(localStorage.getItem("banyan-music") ?? .5); a.play().catch(() => undefined); for (const [name, other] of audio) if ((name === "alpha" || name === "infinite_amethyst") && name !== track) other.pause(); }
function syncVolumes() { for (const [name, track] of audio) track.volume = Number(localStorage.getItem(`banyan-${name === "alpha" || name === "infinite_amethyst" ? "music" : "sfx"}`) ?? (name === "alpha" || name === "infinite_amethyst" ? .5 : .3)); }
const keyLabel = (key: string) => ({ arrowup: "↑", arrowdown: "↓", arrowleft: "←", arrowright: "→", "": "—" }[key] ?? key.toUpperCase());

function setScreen(next: typeof screen) { screen = next; renderShell(); }
function button(text: string, action: string, variant = "") { return `<button class="button ${variant}" data-action="${action}">${text}</button>`; }

function renderShell() {
  if (screen === "game") { renderGame(); return; }
  const pages: Record<Exclude<typeof screen, "game">, string> = {
    home: `<main class="home"><div class="brand-mark"><span></span><span></span><span></span></div><h1>Core of banyan</h1><p class="subtitle">榕树之心</p><p class="tagline">在六边形枝网中生长、连接与守护你的根</p><div class="menu">${button("Start", "new", "primary")}${button("Custom", "custom")}${button("Tutorial", "tutorial")}${button("Settings", "settings")}${button("Help", "help")}</div><p class="hint">键盘 / 触屏均可操作 · 网页端复刻版</p></main>`,
    custom: customPage(), settings: settingsPage(), help: helpPage()
  };
  app.innerHTML = pages[screen];
  bindActions();
}
function customPage() {
  const count = (type: BotMode) => settings.bots.slice(0, settings.players).filter(bot => bot === type).length;
  const roster = [{ type: "human" as BotMode, label: "真人", color: COLORS[0], min: 1 }, { type: "easy" as BotMode, label: "AI（简单）", color: COLORS[2], min: 0 }, { type: "hard" as BotMode, label: "AI（困难）", color: COLORS[1], min: 0 }].map(item => `<label class="config-row roster-row"><span><i style="background:${item.color}"></i> ${item.label}</span><input data-roster="${item.type}" type="number" min="${item.min}" max="6" value="${count(item.type)}"></label>`).join("");
  return `<main class="panel-page"><button class="back" data-action="home">← 返回</button><h2>自定义对局</h2><p>按原版阵容方式配置对局：真人、简单 AI 与困难 AI 总数最多为六名。</p><section class="config"><label class="config-row"><span>地图大小 <b id="size-value">${settings.size}</b></span><input id="size" type="range" min="3" max="15" value="${settings.size}"></label>${roster}<label class="config-row"><span>障碍物密度 <b id="obstacles-value">${settings.obstacles}%</b></span><input id="obstacles" type="range" min="0" max="40" step="10" value="${settings.obstacles}"></label><label class="config-row"><span>移动频率</span><select id="pace"><option value="1" ${settings.pace === 1 ? "selected" : ""}>1Hz</option><option value=".5" ${settings.pace === .5 ? "selected" : ""}>2Hz</option><option value=".3333333333333333" ${Math.abs(settings.pace - 1 / 3) < .001 ? "selected" : ""}>3Hz</option></select></label></section><div class="actions">${button("开始", "start", "primary")}</div></main>`;
}
function settingsPage() {
  const musicValue = localStorage.getItem("banyan-music") ?? ".5", sfx = localStorage.getItem("banyan-sfx") ?? ".3";
  const virtualFields: { field: BindingKey; label: string }[] = [{ field: "up", label: "上" }, { field: "down", label: "下" }, { field: "left", label: "左" }, { field: "right", label: "右" }, { field: "back", label: "回城" }, { field: "reinforce", label: "加固" }];
  const directFields: { field: BindingKey; label: string }[] = [{ field: "lUp", label: "左上" }, { field: "rUp", label: "右上" }, { field: "left", label: "左" }, { field: "right", label: "右" }, { field: "lDown", label: "左下" }, { field: "rDown", label: "右下" }, { field: "back", label: "回城" }, { field: "reinforce", label: "加固" }];
  const players = controls.map((control, player) => { const fields = control.joystick ? virtualFields : directFields; return `<article class="keyset"><strong><i style="background:${COLORS[player]}"></i> 玩家 ${player + 1}<label class="joystick-toggle"><input type="checkbox" data-joystick="${player}" ${control.joystick ? "checked" : ""}> 虚拟摇杆</label></strong><div>${fields.map(({ field, label }) => `<button class="keybind" data-bind="${player}:${field}" title="点击后按下新按键"><small>${label}</small><kbd>${keyLabel(control[field])}</kbd></button>`).join("")}</div></article>`; }).join("");
  return `<main class="panel-page settings-page"><button class="back" data-action="home">← 返回</button><h2>设置</h2><p>音量与键位会立即保存到本机。虚拟摇杆模式使用上下、左右组合进入六个方向；关闭后可直接设置六方向按键。</p><section class="config"><label class="config-row"><span>音乐音量 <b id="music-value">${Math.round(Number(musicValue) * 100)}%</b></span><input id="music" type="range" min="0" max="1" step=".05" value="${musicValue}"></label><label class="config-row"><span>音效音量 <b id="sfx-value">${Math.round(Number(sfx) * 100)}%</b></span><input id="sfx" type="range" min="0" max="1" step=".05" value="${sfx}"></label></section><section class="controls"><div class="controls-heading"><h3>键位设置</h3>${button("恢复默认", "reset-keys")}</div>${players}</section></main>`;
}
function helpPage() { return `<main class="panel-page help"><button class="back" data-action="home">← 返回</button><h2>游戏说明</h2><p>你是一颗榕树核心。移动会长出枝干；在自己的枝干上只能沿已有连接移动，枝网不能形成回路。</p><div class="rule-grid"><article><strong>创造力 E</strong><span>与树根相连的活枝越多，增长越快；攻占结点、加固枝干都会消耗它。</span></article><article><strong>坚固性 D</strong><span>每个结点有坚固性。连根时持续恢复，断根或被害虫啃食会不断流失。</span></article><article><strong>果实与害虫</strong><span>果实提供创造力，害虫会侵蚀枝干。走到其所在结点即可获得或消灭。</span></article><article><strong>落叶归根</strong><span>按回城键立即回到根，但会失去当前所在结点；加固会强化当前结点及相邻枝干。</span></article></div><div class="actions">${button("进入自定义对局", "custom", "primary")}</div></main>`; }

function renderGame() {
  app.innerHTML = `<div class="game-shell"><canvas id="board" aria-label="榕树之心游戏地图"></canvas><div class="topbar"><div class="game-title"><b>榕树之心</b><span>CORE OF BANYAN</span></div><div id="game-status" class="game-status"></div><div class="top-actions"><button class="icon-button" data-action="help">?</button><button class="icon-button" data-action="pause">Ⅱ</button></div></div><aside id="player-panel" class="player-panel"></aside><div class="network-legend"><span class="connected">● 连根</span><span class="disconnected">● 断根</span><span class="root">◇ 树根</span></div><div id="toast-layer" class="toast-layer"></div><div class="mobile-controls"><button data-move="2">↖</button><button data-move="3">↗</button><button data-move="0">←</button><button data-move="1">→</button><button data-move="4">↙</button><button data-move="5">↘</button></div><div class="skill-controls"><button data-action="return"><small>1</small>落叶归根</button><button data-action="reinforce"><small>2</small>固若金汤</button></div><div id="tutorial-card" class="tutorial-card ${tutorial ? "" : "hidden"}"></div><div id="modal" class="modal hidden"></div></div>`;
  bindActions(); bindGameInputs(); drawLoop();
  renderTutorialCard();
}

function startGame(isTutorial = false) { if (isTutorial) { startTutorialLevel(1); return; } tutorial = null; floatingNotices = []; touchDirection = -1; touchPointer = null; nextHudUpdate = 0; music("infinite_amethyst"); game = new BanyanGame(settings); selectedPlayer = 0; screen = "game"; renderShell(); }
function startTutorialLevel(level: number) { const session = createTutorial(level); game = session.game; tutorial = session.state; floatingNotices = []; touchDirection = -1; touchPointer = null; nextHudUpdate = 0; selectedPlayer = 0; music("infinite_amethyst"); screen = "game"; renderShell(); }
function advanceActiveTutorial() { if (!tutorial || !game) return; const next = continueTutorial(tutorial, game); if (next === "next-level") startTutorialLevel(tutorial.level + 1); else { tutorial = next; renderTutorialCard(); } }
function renderTutorialCard() { const card = document.querySelector<HTMLDivElement>("#tutorial-card"); if (!card || !tutorial) return; card.classList.remove("hidden"); card.innerHTML = `<p class="tutorial-kicker">新手教程 · ${tutorial.level}/4</p><p>${tutorial.text}</p>${tutorial.inputAllowed ? "<span class=\"tutorial-goal\">完成目标以继续</span>" : button(tutorial.continueLabel ?? "继续", "tutorial-next", "primary")}`; card.querySelector<HTMLElement>("[data-action=tutorial-next]")?.addEventListener("click", advanceActiveTutorial); }
function bindActions() { app.querySelectorAll<HTMLElement>("[data-action]").forEach(el => el.addEventListener("click", () => { const action = el.dataset.action!; if (action === "home") { tutorial = null; music("alpha"); setScreen("home"); } else if (action === "new") startGame(); else if (action === "start") startGame(); else if (action === "tutorial") startGame(true); else if (action === "custom" || action === "settings") setScreen(action); else if (action === "help") { if (screen === "game") openHelpModal(); else setScreen("help"); } else if (action === "pause") openPause(); else if (action === "return" && (!tutorial || tutorial.inputAllowed)) game?.returnHome(selectedPlayer); else if (action === "reinforce" && (!tutorial || tutorial.inputAllowed)) game?.reinforce(selectedPlayer); else if (action === "tutorial-next") advanceActiveTutorial(); else if (action === "reset-keys") { controls = defaultControls.map(c => ({ ...c })); localStorage.setItem("banyan-controls", JSON.stringify(controls)); renderShell(); } }));
  app.querySelectorAll<HTMLButtonElement>("[data-bind]").forEach(bind => bind.addEventListener("click", () => { const [player, field] = bind.dataset.bind!.split(":"); captureBinding = { player: Number(player), field: field as BindingKey }; bind.classList.add("capturing"); bind.querySelector("kbd")!.textContent = "按键…"; }));
  app.querySelectorAll<HTMLInputElement>("[data-joystick]").forEach(toggle => toggle.addEventListener("change", () => { controls[Number(toggle.dataset.joystick)].joystick = toggle.checked; localStorage.setItem("banyan-controls", JSON.stringify(controls)); renderShell(); }));
  app.querySelectorAll<HTMLInputElement>("[data-roster]").forEach(input => input.addEventListener("change", () => { const changed = input.dataset.roster as BotMode; const counts: Record<BotMode, number> = { human: 0, easy: 0, hard: 0 }; app.querySelectorAll<HTMLInputElement>("[data-roster]").forEach(field => { counts[field.dataset.roster as BotMode] = Math.max(field.dataset.roster === "human" ? 1 : 0, Math.min(6, Number(field.value) || 0)); }); const total = counts.human + counts.easy + counts.hard; if (total > 6) counts[changed] = Math.max(changed === "human" ? 1 : 0, counts[changed] - (total - 6)); settings.players = counts.human + counts.easy + counts.hard; settings.bots = [...Array(counts.human).fill("human"), ...Array(counts.easy).fill("easy"), ...Array(counts.hard).fill("hard"), "easy", "easy", "easy", "easy", "easy", "easy"].slice(0, 6) as BotMode[]; renderShell(); }));
  if (screen === "settings") window.onkeydown = event => { if (!captureBinding) return; controls[captureBinding.player][captureBinding.field] = event.key.toLowerCase(); localStorage.setItem("banyan-controls", JSON.stringify(controls)); captureBinding = null; renderShell(); event.preventDefault(); };
  app.querySelectorAll<HTMLInputElement>("input[type=range]").forEach(input => input.addEventListener("input", () => { const key = input.id as "size" | "players" | "obstacles" | "music" | "sfx"; if (key === "music" || key === "sfx") { localStorage.setItem(`banyan-${key === "sfx" ? "sfx" : "music"}`, input.value); syncVolumes(); const output = document.querySelector(`#${key}-value`); if (output) output.textContent = `${Math.round(Number(input.value) * 100)}%`; } else { settings[key] = Number(input.value); const out = document.querySelector(`#${key}-value`); if (out) out.textContent = `${input.value}${key === "obstacles" ? "%" : ""}`; if (key === "players") { const p = document.querySelector(".player-settings"); if (p) p.innerHTML = settings.bots.slice(0, settings.players).map((b, i) => `<label class="config-row"><span><i style="background:${COLORS[i]}"></i> 玩家 ${i + 1}</span><select data-bot="${i}">${(["human", "easy", "hard"] as BotMode[]).map(v => `<option value="${v}" ${b === v ? "selected" : ""}>${v === "human" ? "真人" : v === "easy" ? "简单人机" : "困难人机"}</option>`).join("")}</select></label>`).join(""); bindBotSelects(); } } }));
  document.querySelector<HTMLSelectElement>("#pace")?.addEventListener("change", e => { settings.pace = Number((e.target as HTMLSelectElement).value); }); bindBotSelects();
}
function bindBotSelects() { app.querySelectorAll<HTMLSelectElement>("[data-bot]").forEach(s => s.addEventListener("change", () => { settings.bots[Number(s.dataset.bot)] = s.value as BotMode; })); }
function bindGameInputs() {
  window.onkeydown = event => {
    const key = event.key.toLowerCase();
    if (captureBinding) { controls[captureBinding.player][captureBinding.field] = key; localStorage.setItem("banyan-controls", JSON.stringify(controls)); captureBinding = null; renderShell(); event.preventDefault(); return; }
    if (!game || screen !== "game") return;
    if (key === "escape") { openPause(); return; }
    if (tutorial && !tutorial.inputAllowed) { if (key === " " || key === "enter") advanceActiveTutorial(); return; }
    heldKeys.add(key);
    for (let player = 0; player < game.players.length; player++) {
      const control = controls[player];
      if (settings.bots[player] !== "human") continue;
      if (key === control.back) { selectedPlayer = player; game.returnHome(player); }
      if (key === control.reinforce) { selectedPlayer = player; game.reinforce(player); }
    }
    event.preventDefault();
  };
  window.onkeyup = event => heldKeys.delete(event.key.toLowerCase());
  app.querySelectorAll<HTMLElement>("[data-move]").forEach(b => b.addEventListener("click", () => { if (!tutorial || tutorial.inputAllowed) game?.move(selectedPlayer, Number(b.dataset.move)); }));
  const canvas = app.querySelector<HTMLCanvasElement>("#board");
  const updateTouchDirection = (event: PointerEvent) => { if (!touchPointer || touchPointer.id !== event.pointerId) return; const x = event.clientX - touchPointer.x, y = event.clientY - touchPointer.y; if (Math.hypot(x, y) < 18) { touchDirection = -1; return; } const left = x < -8, right = x > 8, up = y < -8, down = y > 8; touchDirection = left && up ? 4 : right && up ? 5 : left && down ? 2 : right && down ? 3 : left ? 0 : right ? 1 : up ? 4 : 3; };
  canvas?.addEventListener("pointerdown", event => { if (event.pointerType !== "touch" || (tutorial && !tutorial.inputAllowed)) return; touchPointer = { id: event.pointerId, x: event.clientX, y: event.clientY, player: selectedPlayer }; canvas.setPointerCapture(event.pointerId); updateTouchDirection(event); });
  canvas?.addEventListener("pointermove", updateTouchDirection);
  const endTouch = (event: PointerEvent) => { if (touchPointer?.id === event.pointerId) { touchPointer = null; touchDirection = -1; } };
  canvas?.addEventListener("pointerup", endTouch); canvas?.addEventListener("pointercancel", endTouch);
}
function moveFromHeldKeys() {
  if (!game || (tutorial && !tutorial.inputAllowed)) return;
  for (let player = 0; player < game.players.length; player++) {
    if (settings.bots[player] !== "human") continue;
    const control = controls[player], up = heldKeys.has(control.up), down = heldKeys.has(control.down), left = heldKeys.has(control.left), right = heldKeys.has(control.right);
    let direction = -1;
    if (control.joystick) { if (left && up) direction = 4; else if (right && up) direction = 5; else if (left && down) direction = 2; else if (right && down) direction = 3; else if (left) direction = 0; else if (right) direction = 1; else if (up) direction = 4; else if (down) direction = 3; }
    else if (heldKeys.has(control.left)) direction = 0; else if (heldKeys.has(control.right)) direction = 1; else if (heldKeys.has(control.lUp)) direction = 4; else if (heldKeys.has(control.rUp)) direction = 5; else if (heldKeys.has(control.lDown)) direction = 2; else if (heldKeys.has(control.rDown)) direction = 3;
    if (direction >= 0) { selectedPlayer = player; game.move(player, direction); }
  }
  if (touchDirection >= 0 && touchPointer) { selectedPlayer = touchPointer.player; game.move(touchPointer.player, touchDirection); }
}
function openPause() { const modal = document.querySelector<HTMLDivElement>("#modal"); if (!modal) return; if (!modal.classList.contains("hidden")) { modal.classList.add("hidden"); return; } modal.classList.remove("hidden"); modal.innerHTML = `<section><p class="eyebrow">游戏暂停</p><h2>枝干会在此刻静止</h2><div class="modal-actions">${button("继续生长", "resume", "primary")}${button("重新开始", "restart")}${button("回到主页", "quit")}</div></section>`; modal.querySelectorAll<HTMLElement>("[data-action]").forEach(b => b.addEventListener("click", () => { const a = b.dataset.action; if (a === "resume") modal.classList.add("hidden"); if (a === "restart") { game?.reset(); floatingNotices = []; modal.classList.add("hidden"); } if (a === "quit") { game = null; tutorial = null; music("alpha"); setScreen("home"); } })); }
function openHelpModal() { const modal = document.querySelector<HTMLDivElement>("#modal"); if (!modal) return; modal.classList.remove("hidden"); modal.innerHTML = `<section><p class="eyebrow">游戏说明</p><h2>让每一根枝干都连向树根</h2><p>创造力用于攻占与加固；连根的枝干会恢复坚固性并产生果实。按回城键会放弃脚下结点，按加固键强化当前与相邻枝干。</p><div class="modal-actions">${button("返回对局", "resume", "primary")}</div></section>`; modal.querySelector<HTMLElement>("[data-action=resume]")?.addEventListener("click", () => modal.classList.add("hidden")); }

function drawLoop(now = performance.now()) { if (screen !== "game" || !game) return; const delta = (now - last) / 1000; last = now; const modal = document.querySelector("#modal"); if (modal?.classList.contains("hidden")) { moveFromHeldKeys(); game.update(delta); if (tutorial) { const previous = tutorial; tutorial = updateTutorial(tutorial, game); if (tutorial !== previous) renderTutorialCard(); } } drawBoard(); updateHud(); requestAnimationFrame(drawLoop); }
function drawBoard() {
  const canvas = document.querySelector<HTMLCanvasElement>("#board")!; const rect = canvas.getBoundingClientRect(); const ratio = Math.min(devicePixelRatio, 2); const w = Math.floor(rect.width * ratio), h = Math.floor(rect.height * ratio); if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; } const ctx = canvas.getContext("2d")!; ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, rect.width, rect.height); const g = game!; const n = g.settings.size - 1; const scale = Math.min(rect.width / (2 * n + 3), rect.height / (SQRT3 * n + 3)) * .92; const cx = rect.width / 2, cy = rect.height / 2 + 22;
  const pos = (x: number, y: number) => { const p = g.world({ x, y }); return { x: cx + (p.x - n) * scale, y: cy + p.y * scale }; };
  const gradient = ctx.createRadialGradient(cx, cy, 20, cx, cy, Math.max(rect.width, rect.height) * .7); gradient.addColorStop(0, "#16365a"); gradient.addColorStop(1, "#061020"); ctx.fillStyle = gradient; ctx.fillRect(0, 0, rect.width, rect.height);
  ctx.lineCap = "round";
  for (const c of g.cells.values()) { if (c.owner < 0) continue; const a = pos(c.x, c.y); for (const e of c.edges) { const [one, two] = e.split("|"); if (one !== `${c.x}:${c.y}`) continue; const [x, y] = two.split(":").map(Number); const b = pos(x, y), connected = c.nearRoot && g.cell(x, y)?.nearRoot; ctx.strokeStyle = connected ? COLORS[c.owner] : "#e45b63"; ctx.globalAlpha = connected ? .92 : 1; ctx.lineWidth = Math.max(4, scale * .17); ctx.setLineDash(connected ? [] : [Math.max(4, scale * .16), Math.max(3, scale * .11)]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); } }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  for (const c of g.cells.values()) { const p = pos(c.x, c.y), r = scale * .30, baseWidth = scale, baseHeight = scale * 292 / 252, nodeWidth = scale * 293 / 253, nodeHeight = scale; if (c.wall) continue; ctx.globalAlpha = c.owner >= 0 ? .62 : .26; ctx.drawImage(sprites.empty, p.x - baseWidth / 2, p.y - baseHeight / 2, baseWidth, baseHeight); ctx.globalAlpha = 1; if (c.owner >= 0) { const connected = c.nearRoot, marker = c.root ? sprites.SquareRoot : sprites.node; ctx.save(); ctx.globalAlpha = c.root ? .95 : .88; ctx.drawImage(marker, p.x - nodeWidth / 2, p.y - nodeHeight / 2, nodeWidth, nodeHeight); ctx.restore(); ctx.strokeStyle = connected ? COLORS[c.owner] : "#ff8181"; ctx.lineWidth = Math.max(2, scale * .05); if (c.root) { ctx.beginPath(); ctx.arc(p.x, p.y, scale * .43, 0, Math.PI * 2); ctx.stroke(); ctx.strokeStyle = "#ffe477"; ctx.lineWidth = Math.max(1.5, scale * .035); ctx.beginPath(); ctx.arc(p.x, p.y, scale * .35, 0, Math.PI * 2); ctx.stroke(); } else if (!connected) { hex(ctx, p.x, p.y, scale * .39); ctx.stroke(); } const blink = g.elapsed - c.reinforcedAt <= .5 && Math.floor((g.elapsed - c.reinforcedAt) * 5) % 2 === 0; ctx.fillStyle = blink ? "#2678ff" : connected && !c.pest ? "#071326" : "#fff1f1"; ctx.font = `600 ${Math.max(10, scale * .18)}px Banyan`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(Math.floor(c.hp)), p.x, p.y + 1); } if (c.fruit > 0) { ctx.globalAlpha = c.fruit <= 3 && Math.floor(g.elapsed * 2) % 2 === 0 ? .18 : 1; ctx.drawImage(sprites.Fruit, p.x - r * .34, p.y - r * 1.58, r * .68, r * .68); ctx.globalAlpha = 1; } if (c.pest) { ctx.drawImage(sprites.Pest, p.x - r * .68, p.y - r * 1.45, r * 1.36, r * .72); } }
  for (const p of g.players.filter(p => p.alive)) { const progress = p.moving > 0 ? 1 - p.moving / p.moveDuration : 1; const at = pos(p.fromX + (p.x - p.fromX) * progress, p.fromY + (p.y - p.fromY) * progress), r = scale * .34; ctx.drawImage(sprites.Player, at.x - r, at.y - r, r * 2, r * 2); ctx.strokeStyle = COLORS[p.id]; ctx.lineWidth = Math.max(2, scale * .045); ctx.beginPath(); ctx.arc(at.x, at.y, r * .58, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = "#fff"; ctx.font = `800 ${Math.max(10, scale * .16)}px Banyan`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(p.id + 1), at.x, at.y + 1); const onRootNetwork = g.cell(p.x, p.y)?.nearRoot; ctx.font = `700 ${Math.max(10, scale * .16)}px Banyan`; ctx.fillStyle = onRootNetwork ? "#1f63d1" : "#e23238"; ctx.fillText(String(Math.floor(p.energy)), at.x, at.y - r * 1.16); if (g.elapsed < 2) { ctx.font = `700 ${Math.max(9, scale * .13)}px Banyan`; ctx.fillStyle = "#ef4b4c"; ctx.fillText(settings.bots[p.id] === "human" ? `P${p.id + 1}` : `CPU${p.id + 1}`, at.x, at.y - r * 1.76); } }
  floatingNotices = floatingNotices.filter(notice => notice.expiresAt > g.elapsed); for (const notice of floatingNotices) { const at = pos(notice.x, notice.y), age = 1 - (notice.expiresAt - g.elapsed) / .8; ctx.globalAlpha = 1 - age; ctx.fillStyle = "#31e977"; ctx.font = `700 ${Math.max(12, scale * .22)}px Banyan`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(notice.text, at.x, at.y - scale * (.35 + age * .7)); ctx.globalAlpha = 1; }
}
function hex(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) { ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3; const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); } ctx.closePath(); }
function updateHud() { const g = game; if (!g) return; for (const e of g.consumeEvents()) { if (e.kind === "fruit" && e.player !== undefined) { const p = g.players[e.player]; floatingNotices.push({ x: p.x, y: p.y, text: e.text, expiresAt: g.elapsed + .8 }); } if (e.kind === "error" || e.kind === "return" || e.kind === "reinforce" || e.kind === "win" || (e.kind === "capture" && e.text.includes("树根"))) toast(e.text, e.kind); sound(e.kind); } if (g.ended) showWin(g.winner); if (g.elapsed < nextHudUpdate) return; nextHudUpdate = g.elapsed + .1; const panel = document.querySelector("#player-panel"); const status = document.querySelector("#game-status"); if (!panel || !status) return; panel.innerHTML = g.players.filter(p => p.alive).map(p => `<button class="player-card ${p.id === selectedPlayer ? "selected" : ""}" data-player="${p.id}"><i style="background:${COLORS[p.id]}\"></i><span>玩家 ${p.id + 1}${settings.bots[p.id] !== "human" ? " · AI" : ""}</span><b>${Math.floor(p.energy)} E</b></button>`).join(""); panel.querySelectorAll<HTMLElement>("[data-player]").forEach(b => b.onclick = () => { selectedPlayer = Number(b.dataset.player); nextHudUpdate = 0; }); const alive = g.players.filter(p => p.alive).length; status.innerHTML = `<span>${Math.floor(g.elapsed / 60).toString().padStart(2, "0")}:${Math.floor(g.elapsed % 60).toString().padStart(2, "0")}</span><span>${alive} 棵榕树</span>`; }
function toast(text: string, kind: string) { const layer = document.querySelector("#toast-layer"); if (!layer) return; const el = document.createElement("div"); el.className = `toast ${kind}`; el.textContent = text; layer.replaceChildren(el); if (toastTimer) window.clearTimeout(toastTimer); toastTimer = window.setTimeout(() => el.remove(), 1600); }
function showWin(winner: number) { const modal = document.querySelector<HTMLDivElement>("#modal"); if (!modal || !modal.classList.contains("hidden")) return; modal.classList.remove("hidden"); modal.innerHTML = `<section><p class="eyebrow">对局结束</p><h2>玩家 ${winner + 1} 守住了榕树之心</h2><p>最后一棵仍扎根于大地的榕树获得胜利。</p><div class="modal-actions">${button("再来一局", "restart", "primary")}${button("回到主页", "quit")}</div></section>`; modal.querySelectorAll<HTMLElement>("[data-action]").forEach(b => b.addEventListener("click", () => { if (b.dataset.action === "restart") { game?.reset(); modal.classList.add("hidden"); } if (b.dataset.action === "quit") { game = null; setScreen("home"); } })); }

renderShell();
