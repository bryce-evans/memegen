/**
 * Realistic dev dataset: people, memes captioned on the jacebrowning templates (by slug), votes,
 * comments, favorites, and meme tags. Pure data; `seed.ts` renders and writes it. Media is never
 * committed: templates and fonts come from the local `SEED_TEMPLATES_FROM` checkout, and each meme's
 * image is rendered from its template by the client renderer during seeding.
 */

export const SAMPLE_USERS = [
  "dana",
  "eli",
  "frankie",
  "gus",
  "harper",
  "ivy",
  "jules",
  "kai",
  "lena",
  "milo",
  "nora",
  "otto",
] as const;
export type SampleUser = (typeof SAMPLE_USERS)[number];

/** Topic tags people created while posting; built-in `oldschool`/`movie` come from the template import. */
export const SAMPLE_TAGS: { slug: string; name: string; description: string; createdBy: SampleUser }[] = [
  { slug: "programming", name: "Programming", description: "Code, deploys, and the bugs in between", createdBy: "dana" },
  { slug: "office", name: "Office", description: "Meetings, standups, and the coffee machine", createdBy: "harper" },
];

export interface SampleComment {
  author: SampleUser;
  body: string;
  /** Minutes after the meme was posted. */
  afterMinutes: number;
  replies?: { author: SampleUser; body: string; afterMinutes: number }[];
}

export interface SampleMeme {
  title: string;
  owner: SampleUser;
  /** `templates.slug` from the jacebrowning import (`jb/<folder>`). */
  template: string;
  /** One caption per default text box of the template, in order; missing boxes stay empty. */
  captions: string[];
  /** Posted (and created) this many hours before seeding. */
  ageHours: number;
  /** Votes, cast by the other users in SAMPLE_USERS order: the first `up` like it, the next `down` dislike it. */
  up: number;
  down: number;
  tags?: string[];
  favoritedBy?: SampleUser[];
  comments?: SampleComment[];
  visibility?: "public" | "private";
  draft?: boolean;
}

const DAY = 24;

export const SAMPLE_MEMES: SampleMeme[] = [
  {
    title: "Hotfix energy",
    owner: "kai",
    template: "jb/bongo",
    captions: ["Me typing the hotfix", "while prod is down"],
    ageHours: 1,
    up: 3,
    down: 0,
    tags: ["programming"],
    comments: [{ author: "dana", body: "the paws are me at 2am", afterMinutes: 12 }],
  },
  {
    title: "Friday deploys",
    owner: "dana",
    template: "jb/fine",
    captions: ["", "deployed on friday, this is fine"],
    ageHours: 3,
    up: 7,
    down: 1,
    tags: ["programming"],
    favoritedBy: ["eli", "kai"],
    comments: [
      {
        author: "eli",
        body: "who approved this",
        afterMinutes: 20,
        replies: [
          { author: "dana", body: "you did", afterMinutes: 25 },
          { author: "eli", body: "...fair", afterMinutes: 31 },
        ],
      },
      { author: "gus", body: "pager just went off, unrelated I'm sure", afterMinutes: 90 },
    ],
  },
  {
    title: "Docs vs Slack",
    owner: "eli",
    template: "jb/drake",
    captions: ["reading the docs", "asking in slack and waiting 3 hours"],
    ageHours: 9,
    up: 9,
    down: 0,
    tags: ["programming"],
    favoritedBy: ["dana", "nora", "otto"],
    comments: [{ author: "nora", body: "the docs are also wrong though", afterMinutes: 45 }],
  },
  {
    title: "Standup",
    owner: "harper",
    template: "jb/grumpycat",
    captions: ["standup at 9am", "no"],
    ageHours: 20,
    up: 5,
    down: 2,
    tags: ["office"],
  },
  {
    title: "Merge conflicts",
    owner: "gus",
    template: "jb/rollsafe",
    captions: ["can't have merge conflicts", "if you never pull"],
    ageHours: 1.5 * DAY,
    up: 10,
    down: 1,
    tags: ["programming"],
    favoritedBy: ["harper", "jules", "kai", "milo"],
    comments: [
      { author: "milo", body: "taping this above my desk", afterMinutes: 8 },
      {
        author: "lena",
        body: "this is how we lost a week of work in 2019",
        afterMinutes: 60,
        replies: [{ author: "gus", body: "we don't talk about 2019", afterMinutes: 70 }],
      },
    ],
  },
  {
    title: "Testing in prod",
    owner: "frankie",
    template: "jb/interesting",
    captions: ["I don't always test my code", "but when I do, I do it in production"],
    ageHours: 2 * DAY,
    up: 6,
    down: 3,
    tags: ["programming"],
  },
  {
    title: "YAML",
    owner: "ivy",
    template: "jb/astronaut",
    captions: ["Wait, it's all YAML?", "Always has been", "Me", "Platform team"],
    ageHours: 3 * DAY,
    up: 8,
    down: 0,
    tags: ["programming"],
    favoritedBy: ["frankie"],
  },
  {
    title: "Free pizza",
    owner: "jules",
    template: "jb/ackbar",
    captions: ["free pizza in the break room", "it's a trap!"],
    ageHours: 4 * DAY,
    up: 4,
    down: 0,
    tags: ["office"],
    comments: [{ author: "harper", body: "it was a mandatory all-hands", afterMinutes: 15 }],
  },
  {
    title: "Bug or feature",
    owner: "milo",
    template: "jb/fry",
    captions: ["not sure if bug", "or undocumented feature"],
    ageHours: 5 * DAY,
    up: 3,
    down: 1,
    tags: ["programming"],
  },
  {
    title: "The new framework",
    owner: "lena",
    template: "jb/db",
    captions: ["the new JS framework", "me", "the framework I learned last month"],
    ageHours: 6 * DAY,
    up: 11,
    down: 0,
    tags: ["programming"],
    favoritedBy: ["dana", "eli", "gus", "ivy", "otto"],
    comments: [
      { author: "otto", body: "every. single. month.", afterMinutes: 5 },
      { author: "ivy", body: "the girlfriend is jQuery and she's doing fine", afterMinutes: 240 },
    ],
  },
  {
    title: "Is this a microservice",
    owner: "nora",
    template: "jb/pigeon",
    captions: ["junior dev", "a function", "is this a microservice?"],
    ageHours: 9 * DAY,
    up: 7,
    down: 1,
    tags: ["programming"],
  },
  {
    title: "CSS",
    owner: "dana",
    template: "jb/success",
    captions: ["changed one line of css", "nothing else moved"],
    ageHours: 12 * DAY,
    up: 6,
    down: 0,
    tags: ["programming"],
  },
  {
    title: "Migration plan",
    owner: "otto",
    template: "jb/gru",
    captions: ["write the migration", "run it on staging", "run it on prod", "there is no down migration"],
    ageHours: 16 * DAY,
    up: 9,
    down: 1,
    tags: ["programming"],
    comments: [{ author: "lena", body: "felt this in my bones", afterMinutes: 30 }],
  },
  {
    title: "Meetings",
    owner: "harper",
    template: "jb/buzz",
    captions: ["meetings", "meetings everywhere"],
    ageHours: 22 * DAY,
    up: 5,
    down: 0,
    tags: ["office"],
  },
  {
    title: "Rename a column",
    owner: "eli",
    template: "jb/mordor",
    captions: ["one does not simply", "rename a column in prod"],
    ageHours: 27 * DAY,
    up: 8,
    down: 2,
    tags: ["programming"],
  },
  {
    title: "The CI crowd",
    owner: "kai",
    template: "jb/crowd",
    captions: ["Re-run the flaky test", "It turns green"],
    ageHours: 45 * DAY,
    up: 6,
    down: 1,
    tags: ["programming"],
  },
  {
    title: "Frontend and backend",
    owner: "gus",
    template: "jb/handshake",
    captions: ["frontend", "backend", "blaming the network"],
    ageHours: 70 * DAY,
    up: 10,
    down: 0,
    tags: ["programming"],
    favoritedBy: ["nora"],
  },
  {
    title: "Rewrite it",
    owner: "frankie",
    template: "jb/exit",
    captions: ["ship the feature", "me", "rewrite it in rust"],
    ageHours: 120 * DAY,
    up: 4,
    down: 4,
    tags: ["programming"],
    comments: [
      {
        author: "jules",
        body: "the rust rewrite shipped though",
        afterMinutes: 600,
        replies: [{ author: "frankie", body: "the feature didn't", afterMinutes: 615 }],
      },
    ],
  },
  {
    title: "Stonks",
    owner: "ivy",
    template: "jb/stonks",
    captions: ["bought more GPUs", "stonks"],
    ageHours: 200 * DAY,
    up: 7,
    down: 2,
  },
  {
    title: "Philosoraptor on CI",
    owner: "milo",
    template: "jb/philosoraptor",
    captions: ["if a test fails in CI", "and nobody reruns it, is it really flaky?"],
    ageHours: 300 * DAY,
    up: 5,
    down: 0,
    tags: ["programming"],
  },
  {
    title: "Good guy reviewer",
    owner: "nora",
    template: "jb/ggg",
    captions: ["reviews your 2000-line PR", "leaves helpful comments"],
    ageHours: 420 * DAY,
    up: 11,
    down: 0,
    tags: ["programming"],
    favoritedBy: ["kai", "lena"],
  },
  {
    title: "Note to self",
    owner: "dana",
    template: "jb/doge",
    captions: ["such private", "very joke"],
    ageHours: 2 * DAY,
    up: 0,
    down: 0,
    visibility: "private",
  },
  {
    title: "Still drafting",
    owner: "dana",
    template: "jb/yuno",
    captions: ["y u no", "finish this meme"],
    ageHours: 6,
    up: 0,
    down: 0,
    draft: true,
  },
];
