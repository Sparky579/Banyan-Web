import { BanyanGame, type Settings } from "./engine";

export type TutorialState = { level: number; stage: number; text: string; inputAllowed: boolean; continueLabel?: string; complete?: boolean };
const lessonSettings = (players: number): Settings => ({ size: 4, players, obstacles: 0, pace: .4, bots: ["human", "human", "human", "human", "human", "human"] });

const message = (level: number, stage: number, text: string, inputAllowed: boolean, continueLabel?: string): TutorialState => ({ level, stage, text, inputAllowed, continueLabel });

export function createTutorial(level: number) {
  const game = new BanyanGame(lessonSettings(level === 4 ? 2 : 1)); game.beginTutorial(level === 4); setupLevel(game, level); return { game, state: initialState(level) };
}

function setupLevel(game: BanyanGame, level: number) {
  const root = game.cell(0, 0)!; root.hp = level === 4 ? 50 : 1000;
  game.setPlayerState(0, { energy: level === 3 ? 0 : level === 4 ? 200 : 1000 });
  if (level === 1) { game.setCellState(3, 3, { fruit: 99999, fruitEnergy: 12 }); }
  if (level === 2) {
    const path = [[0, 0], [1, 1], [2, 2], [3, 2]];
    for (const [x, y] of path) game.setCellState(x, y, { owner: 0, hp: 1000 });
    for (let i = 1; i < path.length; i++) game.connectCells({ x: path[i - 1][0], y: path[i - 1][1] }, { x: path[i][0], y: path[i][1] });
    game.setCellState(3, 2, { pest: true });
  }
  if (level === 3) {
    game.setCellState(1, 1, { owner: 0, hp: 8 });
    game.connectCells({ x: 0, y: 0 }, { x: 1, y: 1 });
    game.setCellState(2, 2, { owner: 0, hp: 6 });
    game.setPlayerState(0, { x: 2, y: 2, energy: 0 });
  }
  if (level === 4) {
    game.setCellState(6, 6, { hp: 1000 });
    const enemyPath = [[6, 6], [5, 5], [4, 4], [3, 3]];
    for (let i = 1; i < enemyPath.length; i++) { const [x, y] = enemyPath[i]; game.setCellState(x, y, { owner: 1, hp: 8 + i * 7 }); game.connectCells({ x: enemyPath[i - 1][0], y: enemyPath[i - 1][1] }, { x, y }); }
    game.setPlayerState(1, { x: 3, y: 3, energy: 3 });
  }
  game.refresh();
}

function initialState(level: number): TutorialState {
  if (level === 1) return message(1, 1, "按住 A 或 D 来进行左右移动，可以吃掉场地中间的苹果；注意每隔一段时间才能移动一次！", true);
  if (level === 2) return message(2, 1, "去到树枝末端可以消灭害虫，注意树枝是不能长成回路的！", true);
  if (level === 3) return message(3, 1, "噢不！你现在和根断开了！创造力不再自动增加，脚下树枝的坚固性也会逐渐流失。", false, "继续");
  return message(4, 1, "现在我们进入实战！看到中间的榕树核心了吗？当创造力超过它树枝的坚固性时，可以移动过去占领它！", false, "继续");
}

export function continueTutorial(state: TutorialState, game: BanyanGame): TutorialState | "next-level" {
  if (state.inputAllowed) return state;
  if (state.level === 1 && state.stage === 2) { game.setPlayerState(0, { x: 3, y: 3 }); game.setCellState(6, 3, { fruit: 99999, fruitEnergy: 16 }); game.refresh(); return message(1, 3, "现在同时按住 D 和 W，进行斜向移动，吃掉场地角落的苹果；WASD 的其他组合也能进行类似移动！", true); }
  if (state.level === 1 && state.stage === 4) return "next-level";
  if (state.level === 2 && state.stage === 2) return message(2, 3, "现在按下数字键 1，使用“落叶归根”快速回到树根（方形结点）！", true);
  if (state.level === 2 && state.stage === 4) return "next-level";
  if (state.level === 3 && state.stage === 1) return message(3, 2, "你可以使用“落叶归根”快速回到根，使创造力恢复增长！", true);
  if (state.level === 3 && state.stage === 5) return "next-level";
  if (state.level === 4 && state.stage === 1) return message(4, 2, "你需要积累创造力才能占领它的树枝；在此之前请尽快开枝散叶，让创造力快速增长！", false, "准备好了");
  if (state.level === 4 && state.stage === 2) return message(4, 3, "不要忘了吃果实、清害虫和使用技能。现在移动到中央，击退对方核心！", true);
  if (state.level === 4 && state.stage === 4) return message(4, 5, "如果场上只有你一棵榕树，你就获得了胜利；也要当心不要被别人消灭。", true);
  return state;
}

export function updateTutorial(state: TutorialState, game: BanyanGame): TutorialState {
  if (state.complete || !state.inputAllowed) return state;
  const player = game.players[0];
  if (state.level === 1 && state.stage === 1 && game.cell(3, 3)!.fruit === 0) return message(1, 2, "你有没有注意到吃掉苹果时飘起的绿色数字？核心上方的深蓝色数字代表你的创造力，吃苹果时会增加！", false, "继续");
  if (state.level === 1 && state.stage === 3 && game.cell(6, 3)!.fruit === 0) return message(1, 4, "苹果在生成后一段时间会闪烁，不及时吃掉的话会消失！", false, "下一关");
  if (state.level === 2 && state.stage === 1 && !game.cell(3, 2)!.pest) return message(2, 2, "被害虫侵袭的树枝上的数字会减少。黑色数字代表坚固性，减少到 1 后枝干会断开！", false, "继续");
  if (state.level === 2 && state.stage === 3 && player.x === player.home.x && player.y === player.home.y) return message(2, 4, "注意这并不是没有代价的：你失去了刚刚所在的树枝！", false, "下一关");
  if (state.level === 3 && state.stage === 2 && player.x === player.home.x && player.y === player.home.y) return message(3, 3, "非常棒！现在移动回去接上枝干，使它重新与根连通，避免枝干消亡！", true);
  if (state.level === 3 && state.stage === 3 && game.cell(2, 2)!.nearRoot) return message(3, 4, "现在树枝有点脆弱，可以按数字键 2 使用“固若金汤”，加固脚下与直接相连的枝干！", true);
  if (state.level === 3 && state.stage === 4 && game.lastReinforcedPlayer === 0) return message(3, 5, "根是你的一切能量来源。与根连通的枝干越多，创造力增长越快；只有连根的地方才会结果或生虫。", false, "下一关");
  if (state.level === 4 && state.stage === 3 && player.x === 3 && player.y === 3 && game.players[1].x === game.players[1].home.x) { game.setCellState(6, 6, { hp: 50 }); return message(4, 4, "它被我们打回根了！现在去占领它的根，消灭它吧！", false, "继续"); }
  if (state.level === 4 && state.stage === 5 && !game.players[1].alive) return { ...state, complete: true, inputAllowed: false, text: "恭喜！你已完成全部新手教程。" };
  return state;
}
