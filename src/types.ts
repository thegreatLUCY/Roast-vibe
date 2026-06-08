export type Severity = 'cosmetic' | 'smell' | 'real_risk' | 'catastrophic';

export type Bucket = 'secrets' | 'auth_db' | 'ai_slop' | 'classifier' | 'smell';

export type Confidence = 'high' | 'medium' | 'low';

export type ScoreAxis = 'risk' | 'vibe' | 'quality' | 'classifier';

export type Generator =
  | 'lovable'
  | 'bolt'
  | 'v0'
  | 'replit'
  | 'cursor'
  | 'claude_code'
  | 'codex'
  | 'unknown';

export type Tier =
  | 'catastrophic'
  | 'vibe_coder_special'
  | 'surprisingly_functional'
  | 'production_adjacent'
  | 'suspiciously_clean';

export interface Finding {
  ruleId: string;
  bucket: Bucket;
  severity: Severity;
  confidence?: Confidence;
  axis?: ScoreAxis;
  points: number; // positive value; will be subtracted
  title: string;
  evidence: {
    file?: string;
    line?: number;
    snippet?: string;
  };
}

export interface ScoreDetails {
  productionSurface: boolean;
  riskScore: number;
  vibeScore: number;
  qualityScore: number;
  confidenceCounts: Record<Confidence, number>;
  appliedCeilings: { ruleId: string; maxScore: number; reason: string }[];
  comboRules: { id: string; points: number; reason: string }[];
}

export interface ScannedFile {
  path: string;
  content: string;
  size: number;
}

export interface ScannedRepo {
  owner: string;
  name: string;
  sha: string;
  defaultBranch: string;
  sizeKb: number;
  files: ScannedFile[];      // content-loaded, capped at MAX_FILES_TO_SCAN
  allPaths: string[];        // every blob path in the tree
  packageJson: PackageJson | null;
  readme: string | null;
  hasGitignore: boolean;
  envInGitignore: boolean;
}

export interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  [k: string]: unknown;
}

export interface ScanResult {
  scanId: string;
  repo: string;            // "owner/name"
  sha: string;
  defaultBranch: string;
  generator: Generator;
  findings: Finding[];
  score: number;
  tier: Tier;
  deductionsByBucket: Record<Bucket, number>;
  scoreDetails: ScoreDetails;
  roast: { tagline: string; sins: string[]; verdict: string };
  createdAt: number;
}

export interface Env {
  SCAN_RUNNER: DurableObjectNamespace;
  DB: D1Database;
  ASSETS: Fetcher;
  OPENROUTER_API_KEY: string;
  GITHUB_PAT: string;
  ENVIRONMENT: string;
  OPENROUTER_MODEL: string;
  MAX_REPO_SIZE_KB: string;
  MAX_FILES_TO_SCAN: string;
  MAX_LLM_INPUT_TOKENS: string;
  MAX_LLM_OUTPUT_TOKENS: string;
  RATE_LIMIT_PER_IP_PER_DAY: string;
  RATE_LIMIT_GLOBAL_PER_DAY: string;
}
