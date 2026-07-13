export type Point = { x: number; y: number };
export type BotMode = "human" | "easy" | "hard";
export type Settings = { size: number; players: number; obstacles: number; pace: number; bots: BotMode[] };

const SQRT3 = Math.sqrt(3);
const DIRS: Point[] = [{ x: -1, y: -1 }, { x: 1, y: 1 }, { x: 0, y: -1 }, { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }];
export const COLORS = ["#24d873", "#ff7449", "#37d9ff", "#e766e9", "#f7da38", "#a3acbc"];
export const KEYS = [["w", "d", "s", "a", "q", "e"], ["arrowup", "arrowright", "arrowdown", "arrowleft", ",", "."], ["t", "h", "g", "f", "r", "y"], ["i", "l", "k", "j", "u", "o"]];

export type Cell = { x: number; y: number; owner: number; hp: number; root: boolean; wall: boolean; pest: boolean; fruit: number; edges: Set<string>; nearPlayer: boolean; nearRoot: boolean };
export type Player = { id: number; x: number; y: number; home: Point; energy: number; alive: boolean; score: number; moving: number; botAt: number };
export type GameEvent = { kind: "fruit" | "capture" | "return" | "reinforce" | "error" | "win"; text: string; player?: number };

const id = (x: number, y: number) => `${x}:${y}`;
const edgeId = (a: Point, b: Point) => [id(a.x, a.y), id(b.x, b.y)].sort().join("|");

export class BanyanGame {
  settings: Settings;
  cells = new Map<string, Cell>();
  players: Player[] = [];
  elapsed = 0;
  ended = false;
  winner = -1;
  events: GameEvent[] = [];
  private accumulator = 0;
  private readonly step = 1 / 30;

  constructor(settings: Settings) { this.settings = settings; this.reset(); }
  valid(x: number, y: number) { const n = this.settings.size - 1; return x >= 0 && y >= 0 && x <= 2 * n && y <= 2 * n && Math.abs(x - y) <= n; }
  cell(x: number, y: number) { return this.cells.get(id(x, y)); }
  neighbors(c: Point) { return DIRS.map(d => ({ x: c.x + d.x, y: c.y + d.y })).filter(p => this.valid(p.x, p.y)); }
  reset() {
    this.cells.clear(); this.players = []; this.elapsed = 0; this.ended = false; this.winner = -1; this.events = [];
    const n = this.settings.size - 1;
    for (let x = 0; x <= 2 * n; x++) for (let y = 0; y <= 2 * n; y++) if (this.valid(x, y)) this.cells.set(id(x, y), { x, y, owner: -1, hp: 1, root: false, wall: false, pest: false, fruit: 0, edges: new Set(), nearPlayer: false, nearRoot: false });
    const homes = this.homes(n, this.settings.players);
    homes.forEach((home, index) => { const c = this.cell(home.x, home.y)!; c.owner = index; c.hp = 50; c.root = true; this.players.push({ id: index, x: home.x, y: home.y, home, energy: 3, alive: true, score: 0, moving: 0, botAt: 0 }); });
    this.placeWalls(); this.recomputeNetworks();
  }
  private homes(n: number, count: number): Point[] {
    const all = [{ x: 0, y: 0 }, { x: 2 * n, y: 2 * n }, { x: n, y: 0 }, { x: 0, y: n }, { x: 2 * n, y: n }, { x: n, y: 2 * n }];
    if (count === 2) return [all[0], all[1]];
    if (count === 3) return [all[0], all[4], all[5]];
    if (count === 4) return [all[2], all[4], all[3], all[5]];
    return all.slice(0, count);
  }
  private placeWalls() {
    const target = Math.floor(this.cells.size * this.settings.obstacles / 100);
    let placed = 0; const candidates = [...this.cells.values()].filter(c => !c.root);
    for (let tries = 0; placed < target && tries < target * 30; tries++) { const c = candidates[(Math.random() * candidates.length) | 0]; if (c.wall) continue; c.wall = true; if (this.boardConnected()) placed++; else c.wall = false; }
  }
  private boardConnected() {
    const start = [...this.cells.values()].find(c => !c.wall); if (!start) return false; const seen = new Set([id(start.x, start.y)]); const queue = [start];
    for (let i = 0; i < queue.length; i++) for (const p of this.neighbors(queue[i])) { const c = this.cell(p.x, p.y)!; if (!c.wall && !seen.has(id(p.x, p.y))) { seen.add(id(p.x, p.y)); queue.push(c); } }
    return seen.size === [...this.cells.values()].filter(c => !c.wall).length;
  }
  update(delta: number) {
    if (this.ended) return; this.accumulator = Math.min(this.accumulator + delta, .25);
    while (this.accumulator >= this.step) { this.tick(this.step); this.accumulator -= this.step; }
  }
  private tick(dt: number) {
    this.elapsed += dt; this.recomputeNetworks();
    for (const player of this.players) player.moving = Math.max(0, player.moving - dt);
    for (const c of this.cells.values()) {
      if (c.owner < 0 || c.wall) continue; const p = this.players[c.owner];
      if (c.nearRoot) { c.hp = Math.min(9999, c.hp + .2 * dt * (1 + p.score / 3)); if (c.nearPlayer) p.energy += .5 * dt * (1 + p.score / 3); }
      else c.hp -= .5 * dt;
      if (c.pest) c.hp -= .5 * dt;
      if (c.hp <= 1 && !c.root) this.clearCell(c);
      if (c.fruit > 0) c.fruit -= dt;
    }
    if (Math.random() < .05 * dt) this.spawn("fruit"); if (Math.random() < .01 * dt) this.spawn("pest");
    this.runBots();
  }
  private recomputeNetworks() {
    for (const c of this.cells.values()) { c.nearPlayer = false; c.nearRoot = false; }
    for (const p of this.players.filter(p => p.alive)) { this.walk(p.x, p.y, p.id, "nearPlayer"); this.walk(p.home.x, p.home.y, p.id, "nearRoot"); }
  }
  private walk(x: number, y: number, owner: number, prop: "nearPlayer" | "nearRoot") {
    const origin = this.cell(x, y); if (!origin || origin.owner !== owner) return; const seen = new Set<string>(); const queue = [origin];
    for (let i = 0; i < queue.length; i++) { const c = queue[i]; const key = id(c.x, c.y); if (seen.has(key)) continue; seen.add(key); c[prop] = true;
      for (const n of this.neighbors(c)) { const nc = this.cell(n.x, n.y)!; if (nc.owner === owner && c.edges.has(edgeId(c, n))) queue.push(nc); }
    }
  }
  move(playerId: number, direction: number) {
    const p = this.players[playerId]; if (!p?.alive || this.ended || p.moving > 0) return false; const d = DIRS[direction]; const next = { x: p.x + d.x, y: p.y + d.y }; const from = this.cell(p.x, p.y)!; const to = this.cell(next.x, next.y);
    if (!to || to.wall) return this.note("error", "前方没有可生长的枝干", playerId);
    if (to.owner === p.id && to.nearPlayer && !from.edges.has(edgeId(from, to))) return this.note("error", "你的树枝不能形成回路", playerId);
    if (to.owner !== p.id && p.energy < to.hp) return this.note("error", "创造力不足，无法攻占此结点", playerId);
    if (to.owner !== p.id) {
      const previousOwner = to.owner;
      if (previousOwner >= 0) { const defender = this.players[previousOwner]; if (defender.alive && defender.x === to.x && defender.y === to.y && p.energy <= defender.energy + to.hp) return this.note("error", "对方核心正在守护此结点", playerId); }
      p.energy -= to.hp; this.capture(to, p.id); this.events.push({ kind: "capture", text: "枝干已占领", player: playerId });
      if (to.root) this.eliminate(previousOwner, playerId);
    }
    const e = edgeId(from, to); from.edges.add(e); to.edges.add(e); p.x = next.x; p.y = next.y; p.moving = this.settings.pace;
    for (const other of this.players) if (other.id !== p.id && other.alive && other.x === p.x && other.y === p.y) {
      if (p.energy > other.energy) { p.energy -= other.energy; other.energy = 0; other.x = other.home.x; other.y = other.home.y; this.events.push({ kind: "capture", text: `玩家 ${other.id + 1} 被击退至树根`, player: p.id }); }
      else { p.x = from.x; p.y = from.y; return this.note("error", "对方核心的创造力更强", playerId); }
    }
    this.resolveTile(p); this.recomputeNetworks(); return true;
  }
  private capture(c: Cell, owner: number) { for (const e of c.edges) this.removeEdge(e); c.edges.clear(); c.owner = owner; c.hp = 5; c.pest = false; c.fruit = 0; }
  private eliminate(victim: number, killer: number) { if (victim < 0 || victim === killer) return; const p = this.players[victim]; if (!p?.alive) return; p.alive = false; const root = this.cell(p.home.x, p.home.y)!; root.root = false; root.hp = 5; this.players[killer].score++; this.events.push({ kind: "capture", text: `玩家 ${victim + 1} 的树根被攻占`, player: killer }); const alive = this.players.filter(q => q.alive); if (alive.length <= 1) { this.ended = true; this.winner = alive[0]?.id ?? killer; this.events.push({ kind: "win", text: `玩家 ${this.winner + 1} 获胜！`, player: this.winner }); } }
  private clearCell(c: Cell) { for (const e of c.edges) this.removeEdge(e); c.edges.clear(); c.owner = -1; c.hp = 1; c.pest = false; c.fruit = 0; }
  private removeEdge(e: string) { for (const c of this.cells.values()) c.edges.delete(e); }
  private resolveTile(p: Player) { const c = this.cell(p.x, p.y)!; if (c.fruit > 0) { const gain = c.hp; p.energy += gain; c.fruit = 0; this.events.push({ kind: "fruit", text: `+${Math.floor(gain)} 创造力`, player: p.id }); } if (c.pest) { c.pest = false; this.events.push({ kind: "capture", text: "害虫已消灭", player: p.id }); } }
  returnHome(playerId: number) { const p = this.players[playerId]; if (!p?.alive || (p.x === p.home.x && p.y === p.home.y)) return this.note("error", "你已经在树根了", playerId); const c = this.cell(p.x, p.y)!; this.clearCell(c); p.x = p.home.x; p.y = p.home.y; p.moving = this.settings.pace; this.events.push({ kind: "return", text: "落叶归根", player: playerId }); this.recomputeNetworks(); return true; }
  reinforce(playerId: number) { const p = this.players[playerId]; if (!p?.alive) return false; const c = this.cell(p.x, p.y)!; const amount = p.energy * .025; p.energy *= .9; c.hp += amount; for (const n of this.neighbors(c)) if (c.edges.has(edgeId(c, n))) this.cell(n.x, n.y)!.hp += amount; this.events.push({ kind: "reinforce", text: "固若金汤", player: playerId }); return true; }
  private spawn(kind: "fruit" | "pest") { const candidates = [...this.cells.values()].filter(c => c.owner >= 0 && c.nearRoot && !c.root && !c.wall && !c.pest && c.fruit <= 0 && !this.players.some(p => p.alive && p.x === c.x && p.y === c.y)); if (!candidates.length) return; const c = candidates[(Math.random() * candidates.length) | 0]; if (kind === "fruit") c.fruit = 15; else if (this.players[c.owner].alive) c.pest = true; }
  private runBots() { for (const p of this.players) { const mode = this.settings.bots[p.id]; if (!p.alive || mode === "human" || this.elapsed < p.botAt) continue; p.botAt = this.elapsed + (mode === "hard" ? .45 : .8); const choices = DIRS.map((_, i) => i).sort(() => Math.random() - .5); for (const dir of choices) if (this.move(p.id, dir)) break; if (p.energy > 20 && Math.random() < .18) this.reinforce(p.id); } }
  private note(kind: GameEvent["kind"], text: string, player?: number) { this.events.push({ kind, text, player }); return false; }
  consumeEvents() { const e = this.events; this.events = []; return e; }
  world(c: Point) { return { x: (c.x + c.y) / 2, y: (c.x - c.y) * SQRT3 / 2 }; }
}
