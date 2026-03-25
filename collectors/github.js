import githubRepos from './github-repos.json' with { type: 'json' };

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
    // Commit trend: 'accelerating' | 'decelerating' | 'stable' | null
    commit_trend: null,
    // Commits in recent 30d vs prior 30d (within the 90d window)
    commits_30d: null,
    commits_30d_prev: null,
    // Additional fields for LLM/scoring context
    language: null,
    description: null,
    license: null,
    watchers: null,
    // Round 6: language breakdown + dependency count
    languages: {},
    dependency_count: null,
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

function getMappedRepo(projectName) {
  const key = String(projectName || '').trim().toLowerCase();
  return githubRepos[key] || null;
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
    const mappedRepo = getMappedRepo(projectName);
    let topRepo = null;
    let owner = mappedRepo?.owner || null;
    let repo = mappedRepo?.repo || null;

    if (!owner || !repo) {
      const searchUrl = `${GITHUB_API_BASE}/search/repositories?q=${encodeURIComponent(`${projectName} crypto blockchain`)}&sort=stars&order=desc&per_page=1`;
      const searchResponse = await fetchJson(searchUrl);
      topRepo = searchResponse.data?.items?.[0];

      if (!topRepo?.owner?.login || !topRepo?.name) {
        return { ...fallback, error: 'GitHub repository not found' };
      }

      owner = topRepo.owner.login;
      repo = topRepo.name;
    }

    const [repoInfo, commitsInfo, contributorsInfo, languagesInfo, packageJsonInfo] = await Promise.allSettled([
      fetchJson(`${GITHUB_API_BASE}/repos/${owner}/${repo}`),
      fetchJson(`${GITHUB_API_BASE}/repos/${owner}/${repo}/commits?per_page=1`),
      fetchContributorStats(owner, repo),
      fetchJson(`${GITHUB_API_BASE}/repos/${owner}/${repo}/languages`),
      fetchJson(`${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/package.json`),
    ]);

    const repoData = repoInfo.status === 'fulfilled' ? repoInfo.value.data : topRepo;
    const commitsData = commitsInfo.status === 'fulfilled' ? commitsInfo.value.data : [];
    const commitsHeader = commitsInfo.status === 'fulfilled' ? commitsInfo.value.headers.get('link') : null;
    const contributorStats = contributorsInfo.status === 'fulfilled' ? contributorsInfo.value.data : [];

    // Round 6: language breakdown
    const languagesData = languagesInfo.status === 'fulfilled' ? (languagesInfo.value.data || {}) : {};

    // Round 6: dependency count from package.json (if present)
    let dependencyCount = null;
    if (packageJsonInfo.status === 'fulfilled') {
      try {
        const fileContent = packageJsonInfo.value.data;
        // GitHub API returns base64-encoded content
        const decoded = Buffer.from(fileContent?.content || '', 'base64').toString('utf-8');
        const pkg = JSON.parse(decoded);
        const deps = Object.keys(pkg?.dependencies || {}).length;
        const devDeps = Object.keys(pkg?.devDependencies || {}).length;
        dependencyCount = deps + devDeps;
      } catch {
        dependencyCount = null;
      }
    }

    // Compute commit stats from weekly contributor data (13 weeks = ~91 days)
    let commits90d = null;
    let commits30d = null;
    let commits30dPrev = null;
    let commitTrend = null;

    if (Array.isArray(contributorStats) && contributorStats.length > 0) {
      // Last 13 weeks (~90d), split into recent 4w vs prior 4w for trend
      const allWeeklyCommits = new Array(13).fill(0);
      for (const contributor of contributorStats) {
        const weeks = Array.isArray(contributor?.weeks) ? contributor.weeks.slice(-13) : [];
        for (let i = 0; i < weeks.length; i++) {
          allWeeklyCommits[i] += Number(weeks[i]?.c || 0);
        }
      }
      commits90d = allWeeklyCommits.reduce((s, c) => s + c, 0);
      // Recent 4 weeks (last ~30d)
      commits30d = allWeeklyCommits.slice(-4).reduce((s, c) => s + c, 0);
      // Prior 4 weeks (weeks 5-8 from end)
      commits30dPrev = allWeeklyCommits.slice(-8, -4).reduce((s, c) => s + c, 0);
      // Trend classification
      if (commits30dPrev > 0) {
        const changeRatio = commits30d / commits30dPrev;
        if (changeRatio >= 1.3) commitTrend = 'accelerating';
        else if (changeRatio <= 0.7) commitTrend = 'decelerating';
        else commitTrend = 'stable';
      } else if (commits30d > 0) {
        commitTrend = 'accelerating'; // Started from zero
      } else {
        commitTrend = 'inactive';
      }
    }

    return {
      ...fallback,
      repo_url: repoData?.html_url || topRepo?.html_url || `https://github.com/${owner}/${repo}`,
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
      commit_trend: commitTrend,
      commits_30d: commits30d,
      commits_30d_prev: commits30dPrev,
      language: repoData?.language || topRepo?.language || null,
      description: repoData?.description || topRepo?.description || null,
      license: repoData?.license?.spdx_id || repoData?.license?.name || null,
      watchers: repoData?.watchers_count ?? null,
      languages: languagesData,
      dependency_count: dependencyCount,
      error: null,
    };
  } catch (error) {
    return {
      ...fallback,
      error: error.name === 'AbortError' ? 'GitHub timeout' : error.message,
    };
  }
}
