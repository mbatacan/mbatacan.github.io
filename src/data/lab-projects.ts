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
    title: 'about-me',
    description: 'A Python/LangChain project — for when you\'re too lazy to talk about yourself.',
    status: 'completed',
    href: 'https://github.com/mbatacan/about-me',
  },
  {
    title: 'Race an RL Paddler',
    description:
      'A 3D outrigger canoe race against PPO policies trained offline in a separate repo (ama-flow) and shipped as small in-browser models. Switch between several checkpoints, see the settings and results behind each, or watch one duel a hand-coded baseline.',
    status: 'completed',
    href: '/lab/rl-paddler',
  },
  {
    title: 'KAI',
    description: 'An AI agent for working through Kaggle competitions.',
    status: 'in-progress',
  },
  {
    title: 'open-edge',
    description: 'A calisthenics training tracker.',
    status: 'in-progress',
  },
  {
    title: 'dot',
    description: 'Dotfiles and config for the tools I use day to day.',
    status: 'in-progress',
  },
  {
    title: 'brolouge',
    description: 'A fine-tuned LLM project built as a "friend" clone.',
    status: 'in-progress',
  },
  {
    title: 'Pretty-Print Logger',
    description: 'A Python logging library that pretty-prints its output — logging that\'s actually fun to read.',
    status: 'idea',
  },
  {
    title: 'Fantasy Football Modeler',
    description: 'General sports analytics and modeling for fantasy football.',
    status: 'idea',
  },
];
