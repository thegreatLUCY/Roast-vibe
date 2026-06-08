import type { PackageJson, ScannedFile, ScannedRepo } from '../../src/types';

export function file(path: string, content: string): ScannedFile {
  return {
    path,
    content: content.trimStart(),
    size: content.length,
  };
}

export function repo(files: ScannedFile[], packageJson?: PackageJson): ScannedRepo {
  const allPaths = files.map(f => f.path);
  const rootPackage = files.find(f => f.path === 'package.json');
  const parsedPackage =
    packageJson ??
    (rootPackage ? JSON.parse(rootPackage.content) as PackageJson : null);
  const gitignore = files.find(f => f.path === '.gitignore');

  return {
    owner: 'fixture',
    name: 'app',
    sha: '0123456789abcdef0123456789abcdef01234567',
    defaultBranch: 'main',
    sizeKb: 1,
    files,
    allPaths,
    packageJson: parsedPackage,
    readme: files.find(f => /^README\.md$/i.test(f.path))?.content ?? null,
    hasGitignore: allPaths.includes('.gitignore'),
    envInGitignore: gitignore ? /(^|\n)\.env(\..+)?(\s|$)/.test(gitignore.content) : false,
  };
}
