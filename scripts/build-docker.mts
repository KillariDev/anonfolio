import path from 'node:path';

// Same Docker build entry point as Sealwort; Anonfolio has no build metadata args.
const imageTag = process.argv[2];
if (imageTag === undefined || process.argv.length !== 3) {
  console.error(`Usage: ${process.argv[1] ?? 'scripts/build-docker.mts'} IMAGE_TAG`);
  process.exit(2);
}
try {
  const docker = Bun.spawn(['docker', 'build', '--file', 'Dockerfile', '--tag', imageTag, '.'], {
    cwd: path.resolve(import.meta.dir, '..'), stdin: 'inherit', stdout: 'inherit', stderr: 'inherit',
  });
  process.exit(await docker.exited);
} catch {
  console.error('Docker is unavailable. Install and start Docker before running bun run ui:docker.');
  process.exit(1);
}
