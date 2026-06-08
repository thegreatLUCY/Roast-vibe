import type { Confidence, Finding, ScoreAxis } from './types';

interface FindingMeta {
  axis: ScoreAxis;
  confidence: Confidence;
}

const EXACT: Record<string, FindingMeta> = {
  'secrets.env_committed': { axis: 'risk', confidence: 'high' },
  'secrets.openai_key': { axis: 'risk', confidence: 'high' },
  'secrets.anthropic_key': { axis: 'risk', confidence: 'high' },
  'secrets.stripe_live_key': { axis: 'risk', confidence: 'high' },
  'secrets.aws_access_key': { axis: 'risk', confidence: 'high' },
  'secrets.github_pat': { axis: 'risk', confidence: 'high' },
  'secrets.google_api_key': { axis: 'risk', confidence: 'medium' },
  'secrets.hardcoded_jwt_secret': { axis: 'risk', confidence: 'medium' },
  'secrets.supabase_service_role': { axis: 'risk', confidence: 'high' },
  'secrets.public_env_for_secret': { axis: 'risk', confidence: 'medium' },
  'secrets.env_secret_fallback': { axis: 'risk', confidence: 'high' },

  'authdb.api_route_no_auth': { axis: 'risk', confidence: 'high' },
  'authdb.sql_interpolation': { axis: 'risk', confidence: 'high' },
  'authdb.cors_wildcard': { axis: 'risk', confidence: 'medium' },
  'authdb.localstorage_token': { axis: 'risk', confidence: 'high' },
  'authdb.client_only_auth': { axis: 'risk', confidence: 'high' },
  'authdb.supabase_no_migrations': { axis: 'risk', confidence: 'medium' },
  'authdb.supabase_no_rls': { axis: 'risk', confidence: 'high' },

  'aislop.todo_auth': { axis: 'vibe', confidence: 'medium' },
  'aislop.mock_data_in_render': { axis: 'vibe', confidence: 'medium' },
  'aislop.hardcoded_production_data': { axis: 'vibe', confidence: 'medium' },
  'aislop.frontend_only_commerce_flow': { axis: 'vibe', confidence: 'medium' },
  'aislop.localstorage_database': { axis: 'vibe', confidence: 'high' },
  'aislop.ai_template_readme': { axis: 'vibe', confidence: 'medium' },
  'aislop.alert_ui': { axis: 'vibe', confidence: 'medium' },
  'aislop.emoji_console': { axis: 'vibe', confidence: 'low' },

  'smell.multi_state_libs': { axis: 'quality', confidence: 'medium' },
  'smell.multi_date_libs': { axis: 'quality', confidence: 'low' },
  'smell.multi_form_libs': { axis: 'quality', confidence: 'low' },
  'smell.async_no_try': { axis: 'quality', confidence: 'low' },
  'smell.mega_component': { axis: 'quality', confidence: 'medium' },
};

export function findingMeta(finding: Pick<Finding, 'ruleId' | 'bucket' | 'severity'>): FindingMeta {
  const exact = EXACT[finding.ruleId];
  if (exact) return exact;

  if (finding.ruleId.startsWith('aislop.placeholder_')) {
    return { axis: 'vibe', confidence: 'medium' };
  }
  if (finding.ruleId.startsWith('aislop.default_title_')) {
    return { axis: 'vibe', confidence: 'high' };
  }
  if (finding.ruleId.startsWith('aislop.comment_')) {
    return { axis: 'vibe', confidence: 'medium' };
  }

  switch (finding.bucket) {
    case 'secrets':
    case 'auth_db':
      return { axis: 'risk', confidence: finding.severity === 'catastrophic' ? 'high' : 'medium' };
    case 'ai_slop':
      return { axis: 'vibe', confidence: finding.severity === 'cosmetic' ? 'low' : 'medium' };
    case 'smell':
      return { axis: 'quality', confidence: 'low' };
    case 'classifier':
      return { axis: 'classifier', confidence: 'medium' };
  }
}

export function enrichFinding<T extends Finding>(finding: T): T {
  const meta = findingMeta(finding);
  return { ...finding, ...meta };
}
