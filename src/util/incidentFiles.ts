import { copyFile, lstat, mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export async function artifactFiles(root: string, prefix = ''): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refusing artifact symlink: ${path}`);
    if (entry.isDirectory()) files.push(...await artifactFiles(root, path));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Not a regular artifact: ${path}`);
  }
  return files.sort();
}

async function checkDestination(path: string, directory: boolean): Promise<void> {
  const st = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (st && (st.isSymbolicLink() || (directory ? !st.isDirectory() : !st.isFile()))) {
    throw new Error(`Refusing incompatible or symlink output path: ${path}`);
  }
}

/** Preflight every generated destination before replacing any files. */
export async function publishArtifacts(source: string, destination: string): Promise<void> {
  const root = resolve(destination);
  const files = await artifactFiles(source);
  const dirs = new Set<string>([root]);
  for (const file of files) {
    let dir = dirname(join(root, file));
    while (dir !== root) { dirs.add(dir); dir = dirname(dir); }
    await checkDestination(join(root, file), false);
  }
  for (const dir of dirs) await checkDestination(dir, true);
  for (const dir of [...dirs].sort((a, b) => a.length - b.length)) await mkdir(dir, { recursive: true });
  for (const file of files) await publishFile(join(source, file), join(root, file));
}

/** Rename a newly copied file instead of following links or truncating hardlinks. */
export async function publishFile(source: string, destination: string): Promise<void> {
  await checkDestination(destination, false);
  const temporary = await mkdtemp(join(dirname(destination), '.tauri-publish-'));
  try {
    const staged = join(temporary, 'artifact');
    await copyFile(source, staged);
    await rename(staged, destination);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
