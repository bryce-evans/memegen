/**
 * Deterministic mock dataset for development and e2e tests. Pure data: specs import the
 * expectations below without touching the database; `seed.ts` writes it.
 */

export const MOCK_AUTHORS = ["mock-alice", "mock-bob", "mock-carol", "mock-dave"] as const;
export type MockAuthor = (typeof MOCK_AUTHORS)[number];

/** Voters exist only to give memes their scores. */
export const MOCK_VOTER_COUNT = 12;
export const mockVoter = (i: number) => `mock-voter-${i + 1}`;

export interface MockTemplate {
  key: string;
  name: string;
  /** Hue (0-360) of the generated striped image; `gif` makes an animated template. */
  hue: number;
  gif?: boolean;
  owner: MockAuthor | null;
  tags: string[];
  parent?: string;
}

export const MOCK_TEMPLATES: MockTemplate[] = [
  { key: "classic", name: "Mock Classic", hue: 210, owner: null, tags: ["oldschool"] },
  { key: "classic-night", name: "Mock Classic — Night", hue: 250, owner: null, tags: [], parent: "classic" },
  { key: "animated", name: "Mock Animated", hue: 30, gif: true, owner: "mock-carol", tags: [] },
  { key: "movie", name: "Mock Movie Scene", hue: 0, owner: null, tags: ["movie"] },
];

export interface MockMeme {
  key: string;
  title: string;
  owner: MockAuthor;
  template: string;
  /** Posted (and created) this many hours before seeding. */
  ageHours: number;
  up: number;
  down: number;
  visibility?: "public" | "private";
  draft?: boolean;
  top: string;
  bottom: string;
}

const DAY = 24;

export const MOCK_MEMES: MockMeme[] = [
  { key: "fresh", title: "Mock: Fresh Today", owner: "mock-carol", template: "animated", ageHours: 1, up: 1, down: 0, top: "just posted", bottom: "still warm" },
  { key: "top-week", title: "Mock: Top of the Week", owner: "mock-alice", template: "classic", ageHours: 2 * DAY, up: 8, down: 0, top: "ships on friday", bottom: "no incidents" },
  { key: "flop", title: "Mock: Flop", owner: "mock-alice", template: "animated", ageHours: 3 * DAY, up: 0, down: 1, top: "tabs vs spaces", bottom: "nobody laughed" },
  { key: "controversial", title: "Mock: Controversial", owner: "mock-dave", template: "classic", ageHours: 5 * DAY, up: 1, down: 2, top: "pineapple pizza", bottom: "is fine actually" },
  { key: "solid", title: "Mock: Solid", owner: "mock-alice", template: "classic", ageHours: 10 * DAY, up: 3, down: 0, top: "wrote tests", bottom: "they passed" },
  { key: "also-solid", title: "Mock: Also Solid", owner: "mock-alice", template: "movie", ageHours: 15 * DAY, up: 4, down: 1, top: "one does not simply", bottom: "skip code review" },
  { key: "monthly", title: "Mock: Monthly Classic", owner: "mock-bob", template: "classic", ageHours: 20 * DAY, up: 7, down: 1, top: "monday standup", bottom: "lasts an hour" },
  { key: "meh", title: "Mock: Meh", owner: "mock-alice", template: "classic-night", ageHours: 40 * DAY, up: 1, down: 0, top: "it works", bottom: "on my machine" },
  { key: "half-year", title: "Mock: Half Year Hit", owner: "mock-carol", template: "movie", ageHours: 180 * DAY, up: 9, down: 2, top: "migrated the db", bottom: "zero downtime" },
  { key: "ancient", title: "Mock: Ancient Legend", owner: "mock-bob", template: "movie", ageHours: 400 * DAY, up: 10, down: 0, top: "the original", bottom: "meme" },
  { key: "secret", title: "Mock: Secret", owner: "mock-alice", template: "classic", ageHours: 1 * DAY, up: 0, down: 0, visibility: "private", top: "private", bottom: "joke" },
  { key: "draft", title: "Mock: Draft", owner: "mock-alice", template: "classic", ageHours: 5, up: 0, down: 0, draft: true, top: "half", bottom: "finished" },
];

const meme = (key: string): MockMeme => MOCK_MEMES.find((m) => m.key === key)!;
const isPublic = (m: MockMeme) => !m.draft && m.visibility !== "private";
const titles = (memes: MockMeme[]) => memes.map((m) => m.title);

/**
 * What the UI must show for the dataset (before any test votes). Rankings and stats are hand-written so
 * they check the server independently; the rest is read off MOCK_MEMES.
 */
export const MOCK_EXPECT = {
  /** mock-alice: posted memes (incl. private) scored 8, 3, 3, 1, 0, -1. */
  aliceStats: { memeCount: 6, highScore: 8, hScore: 3 },
  /** Public memes alice's profile shows to other users. */
  alicePublicTitles: titles(MOCK_MEMES.filter((m) => m.owner === "mock-alice" && isPublic(m))),
  /** Best within the last month, highest first (others may interleave). */
  bestMonth: ["Mock: Top of the Week", "Mock: Monthly Classic", "Mock: Solid"],
  /** Not posted within the last month. */
  olderThanMonth: ["Mock: Meh", "Mock: Half Year Hit", "Mock: Ancient Legend"],
  bestAllTime: ["Mock: Ancient Legend", "Mock: Top of the Week", "Mock: Half Year Hit", "Mock: Monthly Classic"],
  newest: ["Mock: Fresh Today", "Mock: Top of the Week", "Mock: Flop", "Mock: Controversial"],
  /** Drafts and private memes never reach the gallery. */
  hidden: titles(MOCK_MEMES.filter((m) => !isPublic(m))),
  controversial: meme("controversial"),
} as const;
