export type Shot = { label: string; clean: boolean; blurred: boolean };

// A numbered "How to fix it" step. `draft` marks a step the AI drafted that
// isn't published yet (shown on a sunk background).
export type Step = { id: string; text: string; shot?: Shot; draft?: string };

export type Playbook = {
  id: string;
  title: string;
  authorId: string;
  published: string;
  uses: number;
  what: string;
  steps: Step[];
  // Set while an unpublished draft exists, e.g. "Draft from Case #412".
  draftFrom?: string;
};
