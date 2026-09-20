import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const RELEASE_ASSETS = ['main.js', 'manifest.json', 'styles.css'];

export const sha256 = data => createHash('sha256').update(data).digest('hex');

export function checkVersions(manifest, pkg, lock, versions, tag) {
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw Error('Version must be bare semver.');
  if (pkg.version !== manifest.version || lock.version !== manifest.version || lock.packages?.['']?.version !== manifest.version) {
    throw Error('Package, lockfile, and manifest versions disagree.');
  }
  if (versions[manifest.version] !== manifest.minAppVersion) throw Error('versions.json does not match minAppVersion.');
  if (tag && tag !== manifest.version) throw Error('Release tag does not match manifest.version.');
  for (const field of ['id', 'name', 'author', 'minAppVersion']) {
    if (typeof manifest[field] !== 'string' || !manifest[field].trim()) throw Error(`Manifest field is required: ${field}`);
  }
}

export function checkAssetMap(files) {
  for (const name of RELEASE_ASSETS) if (!files.get(name)?.length) throw Error(`Missing release asset: ${name}`);
  for (const name of files.keys()) if (!RELEASE_ASSETS.includes(name)) throw Error(`Unexpected release asset: ${name}`);
}

export async function checkRelease(tag) {
  const json = async path => JSON.parse(await readFile(path, 'utf8'));
  const manifest = await json('manifest.json');
  checkVersions(manifest, await json('package.json'), await json('package-lock.json'), await json('versions.json'), tag);
  const files = new Map(await Promise.all(RELEASE_ASSETS.map(async name => [name, await readFile(name)])));
  checkAssetMap(files);
  console.log(`Release checked: ${manifest.id} ${manifest.version}, ${files.size} assets.`);
  return {manifest, files};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await checkRelease(process.argv[2] ?? process.env.RELEASE_TAG);
