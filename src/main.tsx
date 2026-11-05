import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const outputFiles = import.meta.glob<{ default: Record<string, unknown> }>(
  '../amplify_outputs.json',
);
const loadOutputs = outputFiles['../amplify_outputs.json'];

async function loadApp(): Promise<ReactNode> {
  if (loadOutputs) {
    const [{ AmplifyRoot }, outputs] = await Promise.all([import('./AmplifyRoot'), loadOutputs()]);
    return <AmplifyRoot outputs={outputs.default} />;
  }
  // Without a deployed backend, the app runs on browser storage.
  const [{ App }, { createDemoRepository }] = await Promise.all([
    import('./App'),
    import('./data/demoRepository'),
  ]);
  return <App repository={createDemoRepository()} />;
}

const root = createRoot(document.getElementById('root')!);
void loadApp().then((app) => root.render(<StrictMode>{app}</StrictMode>));
