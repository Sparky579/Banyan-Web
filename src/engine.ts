export type Point = { x: number; y: number };
export type BotMode = "human" | "easy" | "medium" | "hard";
export type Settings = { size: number; players: number; obstacles: number; pace: number; bots: BotMode[] };

const SQRT3 = Math.sqrt(3);
const DIRS: Point[] = [{ x: -1, y: -1 }, { x: 1, y: 1 }, { x: 0, y: -1 }, { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }];
const HARD_SEEK: Point[] = [{ x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: -1 }, { x: 0, y: -1 }, { x: -1, y: 0 }];
export const COLORS = ["#24d873", "#ff7449", "#37d9ff", "#e766e9", "#f7da38", "#a3acbc"];

export type Cell = { x: number; y: number; owner: number; hp: number; root: boolean; wall: boolean; pest: boolean; fruit: number; fruitEnergy: number; reinforcedAt: number; edges: Set<string>; nearPlayer: boolean; nearRoot: boolean };
export type Player = { id: number; x: number; y: number; fromX: number; fromY: number; home: Point; energy: number; alive: boolean; score: number; moving: number; moveDuration: number; botAt: number };
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
  tutorialMode = false;
  tutorialSpawns = false;
  lastReinforcedPlayer = -1;
  private accumulator = 0;
  private readonly step = 1 / 30;
  private lastNoticeAt = new Map<string, number>();

  constructor(settings: Settings) { this.settings = settings; this.reset(); }
  valid(x: number, y: number) { const n = this.settings.size - 1; return x >= 0 && y >= 0 && x <= 2 * n && y <= 2 * n && Math.abs(x - y) <= n; }
  cell(x: number, y: number) { return this.cells.get(id(x, y)); }
  neighbors(c: Point) { return DIRS.map(d => ({ x: c.x + d.x, y: c.y + d.y })).filter(p => this.valid(p.x, p.y)); }
  reset() {
    this.cells.clear(); this.players = []; this.elapsed = 0; this.ended = false; this.winner = -1; this.events = []; this.lastReinforcedPlayer = -1; this.lastNoticeAt.clear();
    const n = this.settings.size - 1;
    for (let x = 0; x <= 2 * n; x++) for (let y = 0; y <= 2 * n; y++) if (this.valid(x, y)) this.cells.set(id(x, y), { x, y, owner: -1, hp: 1, root: false, wall: false, pest: false, fruit: 0, fruitEnergy: 0, reinforcedAt: -Infinity, edges: new Set(), nearPlayer: false, nearRoot: false });
    const homes = this.homes(n, this.settings.players);
    homes.forEach((home, index) => { const c = this.cell(home.x, home.y)!; c.owner = index; c.hp = 50; c.root = true; this.players.push({ id: index, x: home.x, y: home.y, fromX: home.x, fromY: home.y, home, energy: 3, alive: true, score: 0, moving: 0, moveDuration: this.settings.pace, botAt: 0 }); });
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
    for (const player of this.players) if (player.alive && this.cell(player.x, player.y)?.owner !== player.id) this.forceHome(player.id);
    if (!this.tutorialMode || this.tutorialSpawns) this.spawnEntities(dt);
    if (!this.tutorialMode) this.runBots();
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
    const e = edgeId(from, to); from.edges.add(e); to.edges.add(e); p.fromX = p.x; p.fromY = p.y; p.x = next.x; p.y = next.y; p.moveDuration = this.settings.pace; p.moving = this.settings.pace;
    for (const other of this.players) if (other.id !== p.id && other.alive && other.x === p.x && other.y === p.y) {
      if (p.energy > other.energy) { p.energy -= other.energy; other.energy = 0; other.fromX = other.x; other.fromY = other.y; other.x = other.home.x; other.y = other.home.y; other.moveDuration = this.settings.pace; other.moving = this.settings.pace; this.events.push({ kind: "capture", text: `玩家 ${other.id + 1} 被击退至树根`, player: p.id }); }
      else { p.x = from.x; p.y = from.y; p.fromX = from.x; p.fromY = from.y; p.moving = 0; return this.note("error", "对方核心的创造力更强", playerId); }
    }
    this.resolveTile(p); this.recomputeNetworks(); return true;
  }
  private capture(c: Cell, owner: number) { for (const e of c.edges) this.removeEdge(e); c.edges.clear(); c.owner = owner; c.hp = 5; c.pest = false; c.fruit = 0; c.fruitEnergy = 0; }
  private eliminate(victim: number, killer: number) { if (victim < 0 || victim === killer) return; const p = this.players[victim]; if (!p?.alive) return; p.alive = false; const root = this.cell(p.home.x, p.home.y)!; root.root = false; root.hp = 5; this.players[killer].score++; this.events.push({ kind: "capture", text: `玩家 ${victim + 1} 的树根被攻占`, player: killer }); const alive = this.players.filter(q => q.alive); if (alive.length <= 1) { this.ended = true; this.winner = alive[0]?.id ?? killer; this.events.push({ kind: "win", text: `玩家 ${this.winner + 1} 获胜！`, player: this.winner }); } }
  private clearCell(c: Cell) { for (const e of c.edges) this.removeEdge(e); c.edges.clear(); c.owner = -1; c.hp = 1; c.pest = false; c.fruit = 0; c.fruitEnergy = 0; }
  private removeEdge(e: string) { for (const c of this.cells.values()) c.edges.delete(e); }
  private resolveTile(p: Player) { const c = this.cell(p.x, p.y)!; if (c.fruit > 0) { const gain = c.fruitEnergy; p.energy += gain; c.fruit = 0; c.fruitEnergy = 0; this.events.push({ kind: "fruit", text: `+${Math.floor(gain)} 创造力`, player: p.id }); } if (c.pest) { c.pest = false; this.events.push({ kind: "capture", text: "害虫已消灭", player: p.id }); } }
  returnHome(playerId: number) { const p = this.players[playerId]; if (!p?.alive || (p.x === p.home.x && p.y === p.home.y)) return this.note("error", "你已经在树根了", playerId); const c = this.cell(p.x, p.y)!; this.clearCell(c); p.fromX = p.x; p.fromY = p.y; p.x = p.home.x; p.y = p.home.y; p.moveDuration = this.settings.pace; p.moving = this.settings.pace; this.events.push({ kind: "return", text: "落叶归根", player: playerId }); this.recomputeNetworks(); return true; }
  private forceHome(playerId: number) { const p = this.players[playerId]; if (!p || !p.alive) return; p.x = p.home.x; p.y = p.home.y; p.fromX = p.home.x; p.fromY = p.home.y; p.moving = 0; this.events.push({ kind: "return", text: "枝干断裂，已回到树根", player: playerId }); this.recomputeNetworks(); }
  reinforce(playerId: number) { const p = this.players[playerId]; if (!p?.alive) return false; const c = this.cell(p.x, p.y)!; const amount = p.energy * .025; p.energy *= .9; c.hp += amount; c.reinforcedAt = this.elapsed; for (const n of this.neighbors(c)) if (c.edges.has(edgeId(c, n))) { const neighbor = this.cell(n.x, n.y)!; neighbor.hp += amount; neighbor.reinforcedAt = this.elapsed; } this.lastReinforcedPlayer = playerId; this.events.push({ kind: "reinforce", text: "固若金汤", player: playerId }); return true; }
  beginTutorial(enableSpawns = false) { this.tutorialMode = true; this.tutorialSpawns = enableSpawns; }
  setCellState(x: number, y: number, state: Partial<Pick<Cell, "owner" | "hp" | "root" | "wall" | "pest" | "fruit" | "fruitEnergy">>) { const cell = this.cell(x, y); if (cell) Object.assign(cell, state); }
  connectCells(a: Point, b: Point) { const one = this.cell(a.x, a.y), two = this.cell(b.x, b.y); if (!one || !two) return; const edge = edgeId(one, two); one.edges.add(edge); two.edges.add(edge); }
  setPlayerState(playerId: number, state: Partial<Pick<Player, "x" | "y" | "energy" | "alive" | "score">>) { const player = this.players[playerId]; if (player) Object.assign(player, state); }
  refresh() { this.recomputeNetworks(); }
  private spawnEntities(dt: number) {
    const pestLimit = this.settings.size - 1;
    const pestCount = new Map<number, number>();
    for (const c of this.cells.values()) if (c.pest && c.owner >= 0) pestCount.set(c.owner, (pestCount.get(c.owner) ?? 0) + 1);
    for (const c of this.cells.values()) {
      if (c.owner < 0 || !c.nearRoot || c.root || c.wall || c.pest || this.players.some(p => p.alive && p.x === c.x && p.y === c.y)) continue;
      if ((pestCount.get(c.owner) ?? 0) < pestLimit && Math.random() < .01 * dt) { c.pest = true; c.fruit = 0; c.fruitEnergy = 0; pestCount.set(c.owner, (pestCount.get(c.owner) ?? 0) + 1); continue; }
      if (c.fruit <= 0 && Math.random() < .05 * dt) { c.fruit = 50 * this.settings.pace; c.fruitEnergy = c.hp; }
    }
  }
  private botDirections(p: Player) {
    const from = this.cell(p.x, p.y)!; const options: { dir: number; cell: Cell; score: number }[] = [];
    DIRS.forEach((d, dir) => {
      const to = this.cell(p.x + d.x, p.y + d.y); if (!to || to.wall) return;
      if (to.owner === p.id && to.nearPlayer && !from.edges.has(edgeId(from, to))) return;
      if (to.owner !== p.id && p.energy < to.hp) return;
      let score = to.fruit > 0 ? 45 + to.fruitEnergy : 0;
      if (to.pest) score += 30;
      if (to.owner === -1) score += 22 - to.hp;
      if (to.owner >= 0 && to.owner !== p.id) score += 60 - to.hp;
      if (to.root && to.owner !== p.id) score += 1000;
      if (to.owner === p.id && !to.nearPlayer) score += 18;
      options.push({ dir, cell: to, score });
    });
    return options;
  }
  private hardPaths(p: Player) {
    type Path = { dist: number; energy: number; prev?: Point };
    const paths = new Map<string, Path>();
    const start = { x: p.x, y: p.y };
    paths.set(id(start.x, start.y), { dist: 0, energy: 0 });
    const queue = [start];
    for (let index = 0; index < queue.length; index++) {
      const from = queue[index], fromCell = this.cell(from.x, from.y)!, fromPath = paths.get(id(from.x, from.y))!;
      for (const d of HARD_SEEK) {
        const to = { x: from.x + d.x, y: from.y + d.y };
        if (!this.valid(to.x, to.y)) continue;
        const cell = this.cell(to.x, to.y)!;
        if (cell.wall || (cell.owner === p.id && cell.nearPlayer && !fromCell.edges.has(edgeId(from, to)))) continue;
        const defender = cell.owner >= 0 && this.players[cell.owner]?.x === to.x && this.players[cell.owner]?.y === to.y ? this.players[cell.owner].energy : 0;
        const next = { dist: fromPath.dist + 1, energy: fromPath.energy + (cell.owner === p.id ? 0 : Math.max(cell.hp, 1)) + defender, prev: from };
        const key = id(to.x, to.y), old = paths.get(key);
        if (!old || next.dist < old.dist || (next.dist === old.dist && next.energy < old.energy)) { paths.set(key, next); queue.push(to); }
      }
    }
    return paths;
  }
  private hardDirectionTo(p: Player, paths: Map<string, { dist: number; energy: number; prev?: Point }>, target?: Point) {
    if (!target) return -1;
    let step = target, path = paths.get(id(step.x, step.y));
    if (!path) return -1;
    while (path?.prev && (path.prev.x !== p.x || path.prev.y !== p.y)) { step = path.prev; path = paths.get(id(step.x, step.y)); }
    return DIRS.findIndex(d => p.x + d.x === step.x && p.y + d.y === step.y);
  }
  private hardNearest(paths: Map<string, { dist: number; energy: number }>, test: (cell: Cell, path: { dist: number; energy: number }) => boolean, randomTie = false) {
    let target: Cell | undefined, best = Infinity;
    for (const cell of this.cells.values()) { const path = paths.get(id(cell.x, cell.y)); if (!path || !test(cell, path)) continue; if (path.dist < best || (randomTie && path.dist === best && Math.random() < .33)) { target = cell; best = path.dist; } }
    return target;
  }
  private hardDecision(p: Player) {
    const paths = this.hardPaths(p), at = this.cell(p.x, p.y)!, home = p.home, homePath = paths.get(id(home.x, home.y));
    const to = (target?: Point) => this.hardDirectionTo(p, paths, target);
    const rootStrength = this.neighbors(home).reduce((sum, point) => { const cell = this.cell(point.x, point.y)!; return sum + (cell.nearRoot ? cell.hp : 0); }, 0);
    const n = this.settings.size - 1;
    for (const enemy of this.players) {
      if (!enemy.alive || enemy.id === p.id) continue;
      const rootDistance = Math.abs(home.x - enemy.x) + Math.abs(home.y - enemy.y), ownDistance = Math.abs(p.x - home.x) + Math.abs(p.y - home.y);
      if (rootDistance <= Math.floor(n / 3) * 2 && ownDistance > n && enemy.energy > rootStrength) return -1;
      if (rootDistance <= 2 && enemy.energy > this.cell(home.x, home.y)!.hp) { if (p.x === home.x && p.y === home.y) return to(enemy); if (ownDistance <= 2) return to(home); return -1; }
    }
    if (p.energy > 10 && (homePath?.dist ?? Infinity) <= 1) this.reinforce(p.id);
    for (const point of this.neighbors(at)) { const cell = this.cell(point.x, point.y)!; if (cell.owner === p.id && cell.nearRoot !== at.nearRoot) return to(point); }
    let adjacentCut: Cell | undefined, maxDegree = 3;
    for (const point of this.neighbors(at)) { const cell = this.cell(point.x, point.y)!; if (cell.owner >= 0 && cell.owner !== p.id && cell.nearRoot && cell.edges.size >= maxDegree && p.energy > cell.hp) { adjacentCut = cell; maxDegree = cell.edges.size; } }
    if (adjacentCut) return to(adjacentCut);
    let enemyRoot: Cell | undefined, lowestEnergy = Infinity;
    for (const enemy of this.players) {
      if (!enemy.alive || enemy.id === p.id) continue;
      const root = this.cell(enemy.home.x, enemy.home.y)!, path = paths.get(id(root.x, root.y)); if (!path) continue;
      const needed = enemy.energy + path.energy;
      if (Math.max(p.x - root.x, p.y - root.y) <= Math.floor(n / 2) && p.energy > needed) return to(root);
      if (((!at.nearRoot && p.energy > needed * 1.5) || (at.nearRoot && p.energy > needed)) && path.energy <= lowestEnergy) { lowestEnergy = path.energy; enemyRoot = root; }
    }
    if (enemyRoot) return to(enemyRoot);
    if (!at.nearRoot) {
      const connectLimit = p.energy < 5 ? 1 : Math.floor(n / 3) * 2;
      const connect = this.hardNearest(paths, (cell, path) => cell.owner === p.id && cell.nearRoot && path.dist < connectLimit && path.energy * 1.2 < p.energy);
      const capture = this.hardNearest(paths, (cell, path) => cell.owner !== p.id && cell.nearRoot && path.dist <= Math.floor(n / 3) && path.energy * 2 < p.energy);
      if (!connect && !capture) return -1;
      if (!connect) return to(capture);
      if (!capture) return Math.random() < .4 ? to(connect) : -1;
      const connectPath = paths.get(id(connect.x, connect.y))!, capturePath = paths.get(id(capture.x, capture.y))!;
      if (connectPath.dist < capturePath.dist) return to(connect);
      return Math.max(capture.x - home.x, capture.y - home.y) < n ? to(capture) : -1;
    }
    if (p.energy > 20 && Math.random() < .1) this.reinforce(p.id);
    let cut: Cell | undefined;
    for (const cell of this.cells.values()) { const path = paths.get(id(cell.x, cell.y)); if (path && cell.owner >= 0 && cell.owner !== p.id && cell.nearRoot && path.dist <= 4 && path.energy * 1.2 <= p.energy) cut = cell; }
    if (cut && (Math.max(cut.x - home.x, cut.y - home.y) <= Math.floor(n / 2) || Math.random() < .4)) return to(cut);
    let target = this.hardNearest(paths, (cell, path) => cell.owner === p.id && !cell.nearPlayer && path.dist <= n && p.energy > path.energy * 1.2);
    if (!target) target = this.hardNearest(paths, (cell, path) => cell.owner === -1 && path.dist <= 2, true);
    if (!target) {
      let branchTarget: Cell | undefined, degree = 0;
      for (const cell of this.cells.values()) if (cell.owner !== p.id && cell.nearRoot && cell.edges.size > degree) { branchTarget = cell; degree = cell.edges.size; }
      target = degree >= 3 ? branchTarget : this.hardNearest(paths, cell => cell.owner === -1, true);
    }
    return to(target);
  }
  private runBots() {
    for (const p of this.players) {
      const mode = this.settings.bots[p.id]; if (!p.alive || mode === "human" || this.elapsed < p.botAt) continue;
      if (mode === "hard") { p.botAt = this.elapsed + this.settings.pace * 1.05; const direction = this.hardDecision(p); if (direction < 0) this.returnHome(p.id); else this.move(p.id, direction); continue; }
      p.botAt = this.elapsed + (mode === "medium" ? .34 : .62);
      const options = this.botDirections(p); if (!options.length) { if (!this.cell(p.x, p.y)?.nearRoot) this.returnHome(p.id); continue; }
      if (mode === "easy") options.sort((a, b) => a.cell.owner === p.id && b.cell.owner !== p.id ? 1 : a.cell.owner !== p.id && b.cell.owner === p.id ? -1 : a.cell.hp - b.cell.hp);
      else options.sort((a, b) => b.score - a.score || a.cell.hp - b.cell.hp);
      this.move(p.id, options[0].dir);
      if (p.energy > (mode === "medium" ? 12 : 24) && Math.random() < (mode === "medium" ? .3 : .12)) this.reinforce(p.id);
    }
  }
  private note(kind: GameEvent["kind"], text: string, player?: number) {
    const key = `${kind}:${player ?? -1}:${text}`;
    const last = this.lastNoticeAt.get(key) ?? -Infinity;
    if (this.elapsed - last >= .65) { this.events.push({ kind, text, player }); this.lastNoticeAt.set(key, this.elapsed); }
    return false;
  }
  consumeEvents() { const e = this.events; this.events = []; return e; }
  world(c: Point) { return { x: (c.x + c.y) / 2, y: (c.x - c.y) * SQRT3 / 2 }; }
}
