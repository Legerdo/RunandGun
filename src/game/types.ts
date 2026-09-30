import type { Surface } from '../engine/surface';
import type { Game } from './world';

export interface Rect { x: number; y: number; w: number; h: number }

export type DmgKind = 'bullet' | 'heavy' | 'pellet' | 'explosion' | 'fire' | 'knife' | 'crush' | 'rocket';
export type Mat = 'flesh' | 'metal' | 'wood' | 'sand' | 'stone' | 'glass';
export type Team = 'player' | 'enemy' | 'neutral';

export interface Hit {
  dmg: number;
  kind: DmgKind;
  x: number;
  y: number;
  dx: number; // normalized direction of the attack
  dy: number;
  force: number;
  from: Team;
}

export interface Solid extends Rect {
  oneway: boolean;
  alive: boolean;
  tag?: string;
}

export const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
export const inRect = (x: number, y: number, r: Rect) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

export abstract class Ent {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  dead = false;
  z = 10;
  hp = 1;
  team: Team = 'neutral';
  hittable = false; // can be hit by player attacks
  meleeable = false; // knife attack triggers when close
  flash = 0;
  tag = '';
  age = 0;
  // enemies that should count toward "clear the arena"
  counts = false;
  // score awarded on kill
  score = 0;

  abstract update(g: Game): void;
  abstract draw(g: Game, s: Surface): void;
  box(): Rect | null {
    return null;
  }
  // Return the impact material if the hit connects, or null if it passes through.
  onHit(_g: Game, _h: Hit): Mat | null {
    return null;
  }
  // Called by explosions & melee to check proximity.
  cx() { return this.x; }
  cy() { return this.y; }
}
