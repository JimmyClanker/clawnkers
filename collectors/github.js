const GITHUB_API_BASE = 'https://api.github.com';
const DEFAULT_TIMEOUT_MS = 12000;

function createEmptyGithubResult(projectName) {
  return {
    project_name: projectName,
    repo_url: null,
    stars: null,
    forks: null,
    open_issues: null,
    last_commit: null,
    contributors: null,
    commits_90d: null,
    error: null,
  };
}

async function fetchJson(url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'alpha-scanner/6.0.0',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    const data = await response.json();
    return { data, headers: response.headers };
  } finally {
    clearTimeout(timeout);
  }
}

function parseLastPage(linkHeader) {
  if (!linkHeader) return null;
  const match = linkHeader.match(/&page=(\d+)>; rel="last"/);
  return match ? Number(match[1]) : null;
}

async function fetchContributorStats(owner, repo) {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/stats/contributors`;
  // GitHub returns 202 while computing stats — retry up to 3 times
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          headers: {
            accept: 'application/vnd.github+json',
            'user-agent': 'alpha-scanner/6.0.0',
          },
          signal: controller.signal,
        });
        if (response.status === 202) {
          // Computing — wait and retry
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        if (!response.ok) return { data: [], headers: response.headers };
        const data = await response.json();
        return { data: Array.isArray(data) ? data : [], headers: response.headers };
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      return { data: [], headers: new Headers() };
    }
  }
  return { data: [], headers: new Headers() };
}

export async function collectGithub(projectName) {
  const fallback = createEmptyGithubResult(projectName);

  try {
    const searchUrl = `${GITHUB_API_BASE}/search/repositories?q=${encodeURIComponent(`${projectName} crypto blockchain`)}&sort=stars&order=desc&per_page=1`;
    const searchResponse = await fetchJson(searchUrl);
    const topRepo = searchResponse.data?.items?.[0];

    if (!topRepo?.owner?.login || !topRepo?.name) {
      return { ...fallback, error: 'GitHub repository not found' };
    }

    const owner = topRepo.owner.login;
    const repo = topRepo.name;

    const [repoInfo, commitsInfo, contributorsInfo] = await Promise.allSettled([
      fetchJson(`${GITHUB_API_BASE}/repos/${owner}/${repo}`),
      fetchJson(`${GITHUB_API_BASE}/repos/${owner}/${repo}/commits?per_page=1`),
      fetchContributorStats(owner, repo),
    ]);

    const repoData = repoInfo.status === 'fulfilled' ? repoInfo.value.data : topRepo;
    const commitsData = commitsInfo.status === 'fulfilled' ? commitsInfo.value.data : [];
    const commitsHeader = commitsInfo.status === 'fulfilled' ? commitsInfo.value.headers.get('link') : null;
    const contributorStats = contributorsInfo.status === 'fulfilled' ? contributorsInfo.value.data : [];

    const commits90d = Array.isArray(contributorStats)
      ? contributorStats.reduce((sum, contributor) => {
          const weeks = Array.isArray(contributor?.weeks) ? contributor.weeks.slice(-13) : [];
          return sum + weeks.reduce((weekSum, week) => weekSum + Number(week?.c || 0), 0);
        }, 0)
      : null;

    return {
      ...fallback,
      repo_url: repoData?.html_url || topRepo.html_url || null,
      stars: repoData?.stargazers_count ?? null,
      forks: repoData?.forks_count ?? null,
      open_issues: repoData?.open_issues_count ?? null,
      last_commit: commitsData?.[0]
        ? {
            sha: commitsData[0].sha,
            date: commitsData[0]?.commit?.author?.date || null,
            message: commitsData[0]?.commit?.message || null,
            estimated_total_commits: parseLastPage(commitsHeader),
          }
        : null,
      contributors: Array.isArray(contributorStats) ? contributorStats.length : null,
      commits_90d: commits90d,
      error: null,
    };
  } catch (error) {
    return {
      ...fallback,
      error: error.name === 'AbortError' ? 'GitHub timeout' : error.message,
    };
  }
}
