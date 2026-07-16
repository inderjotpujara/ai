import { BuilderKind } from '@contracts';
import { BuilderWizard } from './builder-wizard.tsx';

export function AgentWizard() {
  return <BuilderWizard kind={BuilderKind.Agent} title="Agent Builder" />;
}
