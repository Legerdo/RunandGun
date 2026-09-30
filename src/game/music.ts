import type { Song } from '../engine/audio';

// Hand-written chiptune-rock tracks. Tokens: NOTE:len (16ths), r = rest, drums k/s/h/o/c/t.
const bassDm = 'D2:2 D2:1 D3:1 D2:2 D2:2 C3:2 D2:2 A2:2 C3:2';
const bassBb = 'A#1:2 A#1:1 A#2:1 A#1:2 A#1:2 A#2:2 A#1:2 F2:2 A2:2';
const bassC = 'C2:2 C2:1 C3:1 C2:2 C2:2 A#2:2 C2:2 G2:2 A#2:2';
const bassF = 'F2:2 F2:1 F3:1 F2:2 F2:2 D#3:2 F2:2 C3:2 D#3:2';
const bassA = 'A1:2 A1:1 A2:1 A1:2 A1:2 G2:2 A1:2 E2:2 C#3:2';

const dRock = 'kh . h . sh . kh . kh . h k sh . h h';
const dRockFill = 'kh . h . sh . kh . kh . s s st s t t';
const dCrash = 'kc . h . sh . kh . kh . h k sh . h h';

const arp = (a: string, b: string, c: string) => `${a}4 ${b}4 ${c}4 ${b}4 `.repeat(4).trim();

export const SONGS: Record<string, Song> = {
  stage: {
    bpm: 148,
    loop: true,
    bass: [bassDm, bassDm, bassDm, bassBb, bassC, bassDm, bassDm, bassBb, bassC, bassDm, bassF, bassC, bassBb, bassA],
    drum: [dCrash, dRock, dCrash, dRock, dRock, dRockFill, dCrash, dRock, dRock, dRockFill, dCrash, dRock, dRock, dRockFill],
    lead: [
      'r:16', 'r:16',
      'D5:3 A4:1 D5:2 F5:2 E5:2 D5:2 C5:2 A4:2',
      'A#4:4 D5:2 F5:4 G5:2 F5:2 D5:2',
      'C5:3 G4:1 C5:2 E5:2 G5:4 E5:2 C5:2',
      'D5:6 r:2 A4:2 C5:2 D5:2 E5:2',
      'D5:3 A4:1 D5:2 F5:2 E5:2 D5:2 C5:2 A4:2',
      'A#4:4 D5:2 F5:4 G5:2 A5:2 A#5:2',
      'C6:3 A#5:1 A5:2 G5:2 E5:4 C5:2 E5:2',
      'D5:8 r:2 D5:1 E5:1 F5:2 A5:2',
      'F5:3 E5:1 F5:2 A5:4 G5:2 F5:2 E5:2',
      'E5:3 D5:1 E5:2 G5:4 F5:2 E5:2 C5:2',
      'D5:3 C5:1 D5:2 F5:2 A#5:4 A5:2 G5:2',
      'A5:4 G5:2 F5:2 E5:4 C#5:4',
    ],
    harm: ['r:16', 'r:16', arp('D', 'F', 'A'), arp('A#', 'D', 'F'), arp('C', 'E', 'G'), arp('D', 'F', 'A'), arp('D', 'F', 'A'), arp('A#', 'D', 'F'), arp('C', 'E', 'G'), arp('D', 'F', 'A'), arp('F', 'A', 'C'), arp('C', 'E', 'G'), arp('A#', 'D', 'F'), arp('A', 'C#', 'E')],
  },
  boss: {
    bpm: 168,
    loop: true,
    leadWave: 'saw',
    leadVol: 0.8,
    bass: [
      'E2 E2 E3 E2 E2 E2 E3 E2 E2 E2 E3 E2 D3 D3 B2 G2',
      'C2 C2 C3 C2 C2 C2 C3 C2 C2 C2 C3 C2 B2 B2 G2 E2',
      'D2 D2 D3 D2 D2 D2 D3 D2 D2 D2 D3 D2 C3 C3 A2 F#2',
      'B1 B1 B2 B1 B1 B1 B2 B1 B1 B1 B2 B1 A2 A2 F#2 D#2',
    ],
    drum: ['kc h s h k h s k k h s h k s s s', 'k h s h k h s k k h s h k h s h', 'k h s h k h s k k h s h k h s h', 'k h s h k k s k k s s s s s s s'],
    lead: [
      'E5:2 r:1 E5:1 G5:2 E5:2 A5:2 G5:2 F#5:2 D5:2',
      'E5:2 r:1 E5:1 G5:2 E5:2 C6:4 B5:2 G5:2',
      'F#5:2 r:1 F#5:1 A5:2 F#5:2 D6:4 C6:2 A5:2',
      'B5:6 A5:2 G5:2 F#5:2 D#5:4',
    ],
    harm: ['E4 B4 E4 B4 E4 B4 E4 B4 E4 B4 E4 B4 E4 B4 E4 B4', 'C4 G4 C4 G4 C4 G4 C4 G4 C4 G4 C4 G4 C4 G4 C4 G4', 'D4 A4 D4 A4 D4 A4 D4 A4 D4 A4 D4 A4 D4 A4 D4 A4', 'B3 F#4 B3 F#4 B3 F#4 B3 F#4 B3 F#4 B3 F#4 D#4 F#4 B4 D#5'],
  },
  start: {
    bpm: 150,
    loop: false,
    lead: ['D5:2 D5:1 D5:1 A5:4 G5:2 A5:2 C6:2 D6:6 r:10'],
    bass: ['D2:2 D2:2 D2:2 D2:2 C3:2 C3:2 D3:6 r:10'],
    drum: ['kc . s s k . s s kc . s s kc . . . c . . . . . . . . . . . . . . .'],
  },
  clear: {
    bpm: 140,
    loop: false,
    lead: ['D5:2 F#5:2 A5:2 D6:4 C#6:2 D6:2 E6:2 F#6:8 r:8'],
    harm: ['A4:2 D5:2 F#5:2 A5:4 A5:2 A5:2 C#6:2 D6:8 r:8'],
    bass: ['D3:2 D3:2 D3:2 D3:4 A2:2 A2:2 A2:2 D2:8 r:8'],
    drum: ['kc . s . k . s . kc . s s s s s s kc . . . . . . . r:8'],
  },
  gameover: {
    bpm: 90,
    loop: false,
    lead: ['A4:4 G4:4 F4:4 E4:4 D4:12 r:4'],
    bass: ['D3:4 C3:4 A#2:4 A2:4 D2:12 r:4'],
  },
  title: {
    bpm: 120,
    loop: true,
    bass: [bassDm, bassBb, bassC, bassA],
    drum: ['k . h . s . h . k . h . s . h h', 'k . h . s . h . k . h . s . h h', 'k . h . s . h . k . h . s . h h', 'k . h . s . h . k k h . s s s s'],
    harm: [arp('D', 'F', 'A'), arp('A#', 'D', 'F'), arp('C', 'E', 'G'), arp('A', 'C#', 'E')],
  },
};

export function trainSong(): Song {
  return { ...SONGS.stage, bpm: 166 };
}
