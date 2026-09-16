// Fetches recently-pushed-to repos and their latest commits from the GitHub API, at build time.
// Runs in Node during `astro build` / `astro dev` — never in the browser — so a GitHub token can be
// used safely via an env var without ever reaching the client bundle.

const GITHUB_USER = "mbatacan";
const REPO_COUNT = 6;
const COMMITS_PER_REPO = 3;

export interface RepoActivity {
  name: string;
  url: string;
  description: string | null;
  pushedAt: string;
  commits: string[];
}

interface GitHubRepo {
  name: string;
  html_url: string;
  description: string | null;
  pushed_at: string;
  fork: boolean;
}

interface GitHubCommit {
  commit: { message: string };
}

function authHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function githubFetch<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Accept: "application/vnd.github+json", ...authHeaders() },
  });
  if (!res.ok) {
    throw new Error(`GitHub API request failed: ${path} → ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

/** Fetch the most recently pushed-to repos for GITHUB_USER, each with its latest commit messages. */
export async function fetchRecentActivity(): Promise<RepoActivity[]> {
  const repos = await githubFetch<GitHubRepo[]>(
    `/users/${GITHUB_USER}/repos?sort=pushed&direction=desc&per_page=100&type=owner`,
  );
  const recent = repos.filter((r) => !r.fork).slice(0, REPO_COUNT);

  return Promise.all(
    recent.map(async (repo) => {
      const commits = await githubFetch<GitHubCommit[]>(
        `/repos/${GITHUB_USER}/${repo.name}/commits?per_page=${COMMITS_PER_REPO}&author=${GITHUB_USER}`,
      );
      return {
        name: repo.name,
        url: repo.html_url,
        description: repo.description,
        pushedAt: repo.pushed_at,
        commits: commits.map((c) => c.commit.message.split("\n")[0]),
      };
    }),
  );
}
