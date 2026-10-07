// npm test: leaderboard saving and loading.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { Leaderboard } from '../server/leaderboard.ts';

const ann = { id: 'UCann', name: 'Ann' };
const bo = { id: 'UCbo', name: 'Bo' };
const freshDir = () => mkdtempSync(join(tmpdir(), 'nr-lb-'));

describe('leaderboard', () => {
  it('counts wins, rounds and streaks, and survives a restart', () => {
    const dir = freshDir();
    const lb = new Leaderboard(dir);
    lb.record(1, ann, [ann, bo]);
    lb.record(2, ann, [ann, bo]);
    lb.record(3, null, [bo, ann]); // a bot won: nobody's streak continues
    lb.record(4, bo, [bo]); // Ann didn't play: her streak is untouched by this round
    lb.setColour(ann, 'mint');
    lb.save();

    const again = new Leaderboard(dir);
    assert.deepEqual(again.stats(ann.id), { wins: 2, rounds: 3, streak: 0 });
    assert.deepEqual(again.stats(bo.id), { wins: 1, rounds: 4, streak: 1 });
    assert.equal(again.colour(ann.id), 'mint');
    assert.equal(again.nextRound, 5);
    assert.deepEqual(again.top().map((e) => e.name), ['Ann', 'Bo']);
  });

  it('keeps streaks going across consecutive wins', () => {
    const lb = new Leaderboard(freshDir());
    for (let r = 1; r <= 3; r++) lb.record(r, bo, [ann, bo]);
    assert.equal(lb.stats(bo.id).streak, 3);
    lb.record(4, ann, [ann, bo]);
    assert.equal(lb.stats(bo.id).streak, 0);
    assert.equal(lb.stats(ann.id).streak, 1);
  });

  it('only lists winners, follows name changes, and can hide entries', () => {
    const lb = new Leaderboard(freshDir());
    lb.record(1, ann, [ann, bo]);
    assert.deepEqual(lb.top().map((e) => e.id), ['UCann']);
    lb.record(2, null, [{ id: 'UCann', name: 'Ann2' }]);
    assert.equal(lb.top()[0].name, 'Ann2');
    assert.deepEqual(lb.top(10, (e) => e.id === 'UCann'), []);
  });

  it('keeps a backup and falls back to it if the main file is damaged', () => {
    const dir = freshDir();
    const lb = new Leaderboard(dir);
    lb.record(1, ann, [ann]);
    lb.save();
    lb.record(2, ann, [ann]);
    lb.save(); // backup now holds the 1-win version
    assert.ok(existsSync(join(dir, 'leaderboard.backup.json')));

    writeFileSync(join(dir, 'leaderboard.json'), '{ this is not json');
    const recovered = new Leaderboard(dir);
    assert.equal(recovered.stats(ann.id).wins, 1);
    // The damaged file is set aside, not deleted.
    assert.ok(readdirSync(dir).some((f) => f.startsWith('leaderboard.unreadable-')));
  });

  it('starts empty when there is no file yet', () => {
    const dir = freshDir();
    const lb = new Leaderboard(dir);
    assert.deepEqual(lb.top(), []);
    assert.equal(lb.nextRound, 1);
    lb.record(1, ann, [ann]);
    lb.save();
    assert.equal(JSON.parse(readFileSync(join(dir, 'leaderboard.json'), 'utf8')).players.UCann.wins, 1);
  });
});
