/**
 * Starter content for a new deployment: work-appropriate example memes, all published by the reserved `memegen`
 * account, on the jacebrowning templates (by slug). Pure data; `seed.ts` renders and writes it. No users, votes,
 * or comments: real people add those. Ship it as a snapshot (`--label starter`, see README "Snapshots").
 */

export const STARTER_TAG = {
  slug: "getting-started",
  name: "Getting started",
  description: "Examples from memegen to show what you can make",
};

export interface StarterMeme {
  title: string;
  /** `templates.slug` from the jacebrowning import (`jb/<folder>`). */
  template: string;
  /** One caption per default text box of the template, in order; missing boxes stay empty. */
  captions: string[];
  /** Posted this many hours before seeding, so the feed has an order. */
  ageHours: number;
}

export const STARTER_MEMES: StarterMeme[] = [
  { title: "Welcome to memegen", template: "jb/drake", captions: ["Scrolling past other people's memes", "Making your own in Create"], ageHours: 1 },
  { title: "Animated text works too", template: "jb/bongo", captions: ["Me adding animated text", "to a GIF"], ageHours: 2 },
  { title: "Everyone gets an upvote", template: "jb/oprah", captions: ["You get an upvote", "Everybody gets an upvote"], ageHours: 3 },
  { title: "Bring your own image", template: "jb/fry", captions: ["Not sure if there's a template for this", "or if I should just upload my own"], ageHours: 5 },
  { title: "Templates everywhere", template: "jb/buzz", captions: ["Templates", "templates everywhere"], ageHours: 8 },
  { title: "Captions required", template: "jb/mordor", captions: ["One does not simply", "post a meme without a caption"], ageHours: 12 },
  { title: "Tag your team", template: "jb/kermit", captions: ["Tag your team's memes so everyone can find them", "but that's none of my business"], ageHours: 20 },
  { title: "First post", template: "jb/success", captions: ["Picked a template, added text", "first meme posted"], ageHours: 30 },
  { title: "Standups", template: "jb/cmm", captions: ["Standups are better with a meme"], ageHours: 48 },
];
