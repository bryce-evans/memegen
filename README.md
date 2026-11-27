# memegen

**Make memes. Share them. Host it yourself.**

A self-hosted editor and community for image, GIF, and video memes. Start with a familiar template or make something entirely your own.

[![Doge discovers memegen](docs/videos/memegen-intro.png)](https://media.githubusercontent.com/media/bryce-evans/memegen/main/docs/videos/memegen-intro.mp4)

[Download the 42-second demo](https://media.githubusercontent.com/media/bryce-evans/memegen/main/docs/videos/memegen-intro.mp4)

## Make it yours

- **Templates or your own media.** Search the template library, upload an image or video, or start with a blank canvas.
- **A full visual editor.** Add text, images, and stickers. Move, resize, and rotate layers; customize fonts, colors, and outlines.
- **Optional AI assistance.** Describe an idea in Quick Creator, then refine the result in the editor. Bring your own provider key—ordinary editing needs none.

## Beyond a single image

- **GIFs and video.** Use a frame-by-frame timeline, visibility windows, and keyframes to animate layers. Export GIF or MP4; MP4 exports preserve audio.
- **Reusable panels.** Repeat, reorder, and arrange multi-panel templates. Split a source sheet into separate images instead of being locked into its original layout.

## Your community, your instance

- **Share and discover.** Publish to public feeds, vote, comment, and save favorites. Use unlisted links for posts you want outside discovery—not for confidential storage.
- **Keep control.** Rendering happens in the browser. Host media locally or in S3, moderate posts and templates, and back up the database and media together.

## Setup overview

- Install Bun, Node.js, Git, and PostgreSQL.
- Clone the repo and configure Postgres.
- Install dependencies and seed templates.
- Start the server and create a meme.

**[Full setup guide](DEV_SETUP.md)** · [Production deployment](docs/OPERATIONS.md#deployment-setup)

---

[Architecture](ARCH.md) · [Operations](docs/OPERATIONS.md) · [Template library](library/README.md)
