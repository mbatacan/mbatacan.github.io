export interface LabProject {
  title: string;
  description: string;
  status: 'completed' | 'in-progress';
  href?: string; // omitted while there's nothing live to link to yet
}

export const LAB_PROJECTS: LabProject[] = [
  {
    title: 'Fool the Classifier',
    description: 'Draw something and watch a real neural net guess it live, right in your browser.',
    status: 'completed',
    href: '/lab/fool-the-classifier',
  },
  {
    title: 'Race an RL Paddler',
    description:
      'An outrigger canoe race against an opponent controlled by a reinforcement-learning policy, trained offline in a separate repo and shipped as a small in-browser model.',
    status: 'in-progress',
  },
];
