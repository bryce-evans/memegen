import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readdir, rename, rm, rmdir, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify, parseArgs } from "node:util";

const SOURCE_URL = "https://github.com/jacebrowning/memegen.git";
const SOURCE_REVISION = "a8b34146192d9a8fccc9f0d57b73aa947cbdd72d";
const FONT_FILES = [
  "Impact.ttf",
  "TitilliumWeb-Black.ttf",
  "TitilliumWeb-SemiBold.ttf",
  "NotoSans-Bold.ttf",
  "Kalam-Regular.ttf",
  "NotoSansHebrew-Bold.ttf",
];
const exec = promisify(execFile);

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function requireFile(path: string): Promise<void> {
  const info = await stat(path);
  if (!info.isFile() || info.size === 0) throw new Error(`missing or empty asset: ${path}`);
}

async function verifyCheckout(root: string): Promise<void> {
  if (!(await lstat(root)).isDirectory()) throw new Error(`not a directory: ${root}`);
  for (const font of FONT_FILES) await requireFile(join(root, "fonts", font));
  const templates = join(root, "templates");
  const folders = (await readdir(templates, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  if (folders.length === 0) throw new Error(`no template folders in ${templates}`);
  let imageCount = 0;
  for (const folder of folders) {
    const path = join(templates, folder.name);
    await requireFile(join(path, "config.yml"));
    const images = (await readdir(path)).filter((file) => /\.(png|jpe?g|gif|webp)$/i.test(file));
    // Upstream also includes configuration-only test fixtures.
    imageCount += images.length;
    for (const image of images) await requireFile(join(path, image));
  }
  if (imageCount === 0) throw new Error(`no template images in ${templates}`);
}

async function git(cwd: string, action: string, args: string[]): Promise<void> {
  try {
    await exec("git", ["-c", "core.hooksPath=/dev/null", "-c", "submodule.recurse=false", ...args], {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(`${action}: ${(error as Error).message}`, { cause: error });
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { to: { type: "string" } }, allowPositionals: false });
  const destination = values.to ?? process.env.SEED_TEMPLATES_FROM;
  if (!destination?.trim()) throw new Error("set SEED_TEMPLATES_FROM in your config or pass --to PATH");
  const target = resolve(destination);
  if (await exists(target)) {
    try {
      await verifyCheckout(target);
    } catch (error) {
      throw new Error(`refusing incomplete existing destination ${target}; nothing was changed. Choose another --to path. ${(error as Error).message}`);
    }
    console.log(`Reused existing checkout: ${target} (assets verified; revision not changed or asserted)`);
    return;
  }

  await mkdir(dirname(target), { recursive: true });
  const stage = await mkdtemp(join(dirname(target), `.${basename(target)}-download-`));
  try {
    console.log(`Downloading ${SOURCE_URL} at ${SOURCE_REVISION}`);
    await git(stage, "initialize download staging directory", ["init"]);
    await git(stage, "configure source repository", ["remote", "add", "origin", SOURCE_URL]);
    await git(stage, `fetch pinned source revision ${SOURCE_REVISION}`, ["fetch", "--depth=1", "origin", SOURCE_REVISION]);
    await git(stage, "check out pinned source revision", ["checkout", "--detach", SOURCE_REVISION]);
    await verifyCheckout(stage);
    // Reserve the name exclusively: rename must never replace an existing
    // destination, even an empty one created while the download was running.
    await mkdir(target);
    try {
      await rename(stage, target);
    } catch (error) {
      await rmdir(target);
      throw error;
    }
    console.log(`Downloaded seed checkout: ${target} (revision ${SOURCE_REVISION})`);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(`library download: ${(error as Error).message}`);
  process.exitCode = 1;
});
