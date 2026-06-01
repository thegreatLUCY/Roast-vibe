import type { Finding, ScannedRepo } from '../types';
import { firstLineMatch, countMatches } from './util';

export function smellScanners(repo: ScannedRepo): Finding[] {
  const findings: Finding[] = [];
  const deps = {
    ...(repo.packageJson?.dependencies ?? {}),
    ...(repo.packageJson?.devDependencies ?? {}),
  };

  // 1. Multiple state management libraries
  const stateLibs = ['redux', '@reduxjs/toolkit', 'zustand', 'jotai', 'recoil', 'valtio', 'mobx', 'mobx-react'];
  const presentState = stateLibs.filter(n => n in deps);
  if (presentState.length >= 2) {
    findings.push({
      ruleId: 'smell.multi_state_libs',
      bucket: 'smell',
      severity: 'smell',
      points: 3,
      title: `Multiple state management libraries: ${presentState.join(', ')}`,
      evidence: { file: 'package.json' },
    });
  }

  // 2. Multiple date libraries
  const dateLibs = ['moment', 'date-fns', 'dayjs', 'luxon'];
  const presentDate = dateLibs.filter(n => n in deps);
  if (presentDate.length >= 2) {
    findings.push({
      ruleId: 'smell.multi_date_libs',
      bucket: 'smell',
      severity: 'smell',
      points: 2,
      title: `Multiple date libraries: ${presentDate.join(', ')}`,
      evidence: { file: 'package.json' },
    });
  }

  // 3. Form-library duplication
  const formLibs = ['react-hook-form', 'formik', 'final-form'];
  const presentForm = formLibs.filter(n => n in deps);
  if (presentForm.length >= 2) {
    findings.push({
      ruleId: 'smell.multi_form_libs',
      bucket: 'smell',
      severity: 'smell',
      points: 2,
      title: `Multiple form libraries: ${presentForm.join(', ')}`,
      evidence: { file: 'package.json' },
    });
  }

  // 4. Async-no-try-catch: consolidate across the repo into one finding
  const asyncNoTryFiles: string[] = [];
  for (const file of repo.files) {
    if (!/\.(ts|js|tsx|jsx|mjs)$/.test(file.path)) continue;
    if (/\.(test|spec)\./i.test(file.path) || file.path.includes('__tests__')) continue;
    const asyncFns = countMatches(file.content, /\basync\s+(function|\(|[a-zA-Z_$][\w$]*\s*=\s*\()/);
    const awaits = countMatches(file.content, /\bawait\s+/);
    const tries = countMatches(file.content, /\btry\s*\{/);
    if (asyncFns >= 1 && awaits >= 2 && tries === 0) {
      asyncNoTryFiles.push(file.path);
    }
  }
  if (asyncNoTryFiles.length >= 1) {
    const n = asyncNoTryFiles.length;
    const points = Math.min(2 + Math.floor(n / 2), 5); // 1 file → 2, 4 files → 4, cap at 5
    findings.push({
      ruleId: 'smell.async_no_try',
      bucket: 'smell',
      severity: 'smell',
      points,
      title:
        n === 1
          ? 'Async code with no try/catch (1 file)'
          : `Async code with no try/catch (${n} files)`,
      evidence: { file: asyncNoTryFiles[0] },
    });
  }

  // 5. Massive component file
  for (const file of repo.files) {
    if (!/\.tsx?$/.test(file.path)) continue;
    const lines = file.content.split('\n').length;
    if (lines > 500) {
      const useStates = countMatches(file.content, /\buseState\s*\(/);
      if (useStates >= 8) {
        findings.push({
          ruleId: 'smell.mega_component',
          bucket: 'smell',
          severity: 'smell',
          points: 3,
          title: `Mega component: ${lines} lines, ${useStates} useState calls in one file`,
          evidence: { file: file.path },
        });
      }
    }
  }

  return findings;
}
