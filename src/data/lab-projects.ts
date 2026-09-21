export interface LabProject {
  title: string;
  description: string;
  status: 'completed' | 'in-progress' | 'idea';
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
  {
    title: 'Ask My Portfolio',
    description:
      'A semantic search box over my own blog posts and projects — type a question or a job description, and an in-browser embedding model ranks what\'s actually relevant. No server, no API key, just my own content.',
    status: 'idea',
  },
];
