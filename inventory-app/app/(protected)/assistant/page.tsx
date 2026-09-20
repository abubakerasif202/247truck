import { Bot } from 'lucide-react';

import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { AssistantChat } from '@/components/assistant/assistant-chat';

import { getCurrentAccess } from '@/lib/auth/access';
import { getCurrentLocationScope, describeLocationScope } from '@/lib/location/resolve-scope';
import { getAiConfig } from '@/lib/ai/config';

export default async function AssistantPage() {
  const access = await getCurrentAccess();
  const scope = await getCurrentLocationScope(access);
  const config = getAiConfig();
  const scopeLabel = describeLocationScope(scope);

  return (
    <div className="operations-page max-w-4xl domain-reports">
      <PageHeader
        domain="reports"
        eyebrow="Operations Intelligence"
        title="Ask 24/7"
        subtitle={`${access.role === 'admin' ? 'Admin' : 'Manager'} · ${scopeLabel} · Read-only operations copilot`}
      />

      {!config.enabled ? (
        <EmptyState
          icon={Bot}
          title="Ask 24/7 is not configured"
          description={
            config.reason === 'missing_key'
              ? 'An administrator needs to add an OpenAI API key before this assistant can answer questions. The rest of the application is unaffected.'
              : 'Ask 24/7 is currently disabled for this environment. The rest of the application is unaffected.'
          }
        />
      ) : (
        <AssistantChat scopeLabel={scopeLabel} />
      )}
    </div>
  );
}
