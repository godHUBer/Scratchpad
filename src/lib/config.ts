/**
 * Client configuration + platform capability probes.
 *
 * The app works against any Supabase project once two public env values exist.
 * Everything else (Google provider, Drive sharing) is configured on the service
 * side; where that configuration is missing the UI explains it instead of
 * pretending the feature works.
 */
import { supabaseConfigured, supabasePublishableKey, supabaseUrl } from '../integrations/supabase/client';

export interface AppConfig {
  supabaseConfigured: boolean;
  supabaseUrl: string;
  /** masked key for the settings screen */
  publishableKeyPreview: string;
  basePath: string;
}

export function readAppConfig(): AppConfig {
  return {
    supabaseConfigured,
    supabaseUrl,
    publishableKeyPreview: supabasePublishableKey ? `${supabasePublishableKey.slice(0, 18)}…` : '',
    basePath: import.meta.env.BASE_URL,
  };
}

/** Google sign-in needs the provider enabled in the Supabase dashboard. */
export function googleConfiguredHint(): string {
  return 'Google sign-in must be enabled in Supabase → Authentication → Providers → Google with your own Google Cloud OAuth client. Until then use email and password.';
}
