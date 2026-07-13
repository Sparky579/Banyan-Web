import assert from "node:assert/strict";
import { BanyanGame, type Settings } from "../src/engine";

const settings: Settings = { size: 3, players: 2, obstacles: 0, pace: .01, bots: ["human", "human", "easy", "easy", "easy", "easy"] };
const game = new BanyanGame(settings);

assert.equal(game.cells.size, 19, "a radius-2 board contains 19 valid hex cells");
assert.equal(game.players[0].energy, 3);
assert.equal(game.cell(0, 0)?.root, true);
assert.equal(game.cell(4, 4)?.root, true);

assert.equal(game.move(0, 1), true, "a player can claim a neighboring neutral cell");
assert.equal(game.cell(1, 1)?.owner, 0);
assert.equal(game.cell(1, 1)?.hp, 5);
assert.ok(game.players[0].energy < 3, "capturing spends creation energy");

game.update(.1);
assert.equal(game.move(0, 3), true, "a player can extend the branch after its movement interval");
game.update(.1);
assert.equal(game.move(0, 0), true, "a player can extend around an occupied cell");
game.update(.1);
assert.equal(game.move(0, 5), false, "a player cannot close a branch loop");

assert.equal(game.returnHome(0), true, "returning home clears the current non-root cell");
assert.deepEqual({ x: game.players[0].x, y: game.players[0].y }, { x: 0, y: 0 });
const energyBeforeReinforce = game.players[0].energy;
assert.equal(game.reinforce(0), true);
assert.ok(game.players[0].energy < energyBeforeReinforce, "reinforcement consumes ten percent of current energy");

console.log("engine rules: passed");
