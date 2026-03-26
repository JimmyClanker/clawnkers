import githubRepos from './github-repos.json' with { type: 'json' };

const GITHUB_API_BASE = 'https://api.github.com';
const DEFAULT_TIMEOUT_MS = 12000;

function createEmptyGithubResult(projectName) {
  // Round 191 (AutoResearch): pre-populate repo_url from mappings when available
  // so callers always have a non-null URL when the project is known
  const mapped = getMappedRepo(projectName);
  const mappedUrl = (mapped?.owner && mapped?.repo)
    ? `https://github.com/${mapped.owner}/${mapped.repo}`
    : null;
  return {
    project_name: projectName,
    repo_url: mappedUrl,
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
    // Round 29: CI detection
    has_ci: null,
    // Round 51: latest release
    latest_release: null,
    error: null,
  };
}

// Round 187 (AutoResearch): GitHub fetchJson with retry on 403/429 (rate-limit)
// GitHub returns 403 with Retry-After or X-RateLimit-Reset on secondary rate limits.
async function fetchJson(url, { timeoutMs = DEFAULT_TIMEOUT_MS, retries = 2 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
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

      // Handle GitHub rate limiting (403 secondary limit or 429)
      if ((response.status === 429 || response.status === 403) && attempt < retries) {
        const retryAfter = Number(response.headers.get('retry-after') || 0);
        const resetAt = Number(response.headers.get('x-ratelimit-reset') || 0);
        let delayMs = 1500; // default backoff
        if (retryAfter > 0) delayMs = Math.min(retryAfter * 1000, 8000);
        else if (resetAt > 0) delayMs = Math.min(Math.max((resetAt * 1000 - Date.now()), 0), 8000);
        clearTimeout(timeout);
        await new Promise((r) => setTimeout(r, delayMs));
        lastError = new Error(`GitHub ${response.status} rate-limited: ${url}`);
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }

      const data = await response.json();
      return { data, headers: response.headers };
    } catch (err) {
      lastError = err;
      if (err.name === 'AbortError' || attempt >= retries) throw lastError;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
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

    const [repoInfo, commitsInfo, contributorsInfo, languagesInfo, packageJsonInfo, workflowsInfo, releasesInfo, closedIssuesInfo, openPrsInfo] = await Promise.allSettled([
      fetchJson(`${GITHUB_API_BASE}/repos/${owner}/${repo}`),
      fetchJson(`${GITHUB_API_BASE}/repos/${owner}/${repo}/commits?per_page=1`),
      fetchContributorStats(owner, repo),
      fetchJson(`${GITHUB_API_BASE}/repos/${owner}/${repo}/languages`),
      fetchJson(`${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/package.json`),
      // Round 29: check for CI workflows
      fetchJson(`${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/.github/workflows`),
      // Round 51: check latest release for recent activity
      fetchJson(`${GITHUB_API_BASE}/repos/${owner}/${repo}/releases?per_page=1`),
      // Round 156 (AutoResearch): fetch count of recently closed issues for resolution rate
      fetchJson(`${GITHUB_API_BASE}/repos/${owner}/${repo}/issues?state=closed&per_page=1&page=1`),
      // Round 223 (AutoResearch): open pull requests count — signals active dev pipeline
      fetchJson(`${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls?state=open&per_page=1`),
    ]);

    const repoData = repoInfo.status === 'fulfilled' ? repoInfo.value.data : topRepo;
    const commitsData = commitsInfo.status === 'fulfilled' ? commitsInfo.value.data : [];
    const commitsHeader = commitsInfo.status === 'fulfilled' ? commitsInfo.value.headers.get('link') : null;
    const contributorStats = contributorsInfo.status === 'fulfilled' ? contributorsInfo.value.data : [];

    // Round 6: language breakdown
    const languagesData = languagesInfo.status === 'fulfilled' ? (languagesInfo.value.data || {}) : {};

    // Round 29: CI detection
    const hasCI = workflowsInfo.status === 'fulfilled' &&
      Array.isArray(workflowsInfo.value?.data) &&
      workflowsInfo.value.data.length > 0;

    // Round 51: latest release data
    const latestRelease = (() => {
      if (releasesInfo.status !== 'fulfilled') return null;
      const releases = releasesInfo.value?.data;
      const latest = Array.isArray(releases) ? releases[0] : releases;
      if (!latest?.tag_name) return null;
      return {
        tag: latest.tag_name,
        name: latest.name ?? null,
        published_at: latest.published_at ?? null,
        prerelease: latest.prerelease ?? false,
        days_since_release: latest.published_at
          ? Math.floor((Date.now() - new Date(latest.published_at).getTime()) / 86400000)
          : null,
      };
    })();

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

    // Round 24 (AutoResearch batch): repo health composite signal
    const stars = repoData?.stargazers_count ?? 0;
    const forks = repoData?.forks_count ?? 0;
    const openIssues = repoData?.open_issues_count ?? 0;
    const hasDescription = Boolean(repoData?.description);
    const hasLicense = Boolean(repoData?.license?.spdx_id || repoData?.license?.name);
    const repoHealthScore = (
      (stars > 100 ? 1 : 0) +
      (forks > 20 ? 1 : 0) +
      (hasDescription ? 1 : 0) +
      (hasLicense ? 1 : 0) +
      (hasCI ? 1 : 0) +
      (commits90d > 50 ? 1 : 0)
    );
    const repoHealthTier = repoHealthScore >= 5 ? 'excellent' : repoHealthScore >= 3 ? 'good' : repoHealthScore >= 2 ? 'moderate' : 'poor';

    // Round 9 (AutoResearch nightly): Issue resolution rate — closed issues signal dev responsiveness
    // We don't have closed count, but open/star ratio is a quality proxy
    const issueStarRatio = stars > 0 ? openIssues / stars : null;
    const issueHealthSignal = issueStarRatio === null ? null
      : issueStarRatio < 0.05 ? 'healthy'   // few open issues relative to stars
      : issueStarRatio < 0.2 ? 'moderate'
      : 'issue_heavy'; // many open issues = technical debt signal

    // Round 223 (AutoResearch): open PRs count from Link header last-page count
    const openPrsHeader = openPrsInfo.status === 'fulfilled'
      ? openPrsInfo.value?.headers?.get('link') : null;
    const openPrsCount = openPrsHeader ? parseLastPage(openPrsHeader)
      : (openPrsInfo.status === 'fulfilled' && Array.isArray(openPrsInfo.value?.data)
        ? openPrsInfo.value.data.length
        : null);

    // Round 156 (AutoResearch): issue resolution rate — closed vs total issues
    const closedIssuesHeader = closedIssuesInfo.status === 'fulfilled'
      ? closedIssuesInfo.value?.headers?.get('link') : null;
    const totalClosedEstimate = closedIssuesHeader ? parseLastPage(closedIssuesHeader) : null;
    const issueResolutionRate = (totalClosedEstimate != null && openIssues != null && totalClosedEstimate + openIssues > 0)
      ? parseFloat(((totalClosedEstimate / (totalClosedEstimate + openIssues)) * 100).toFixed(1))
      : null;

    // Round 196 (AutoResearch): commit_frequency — avg commits/week over 90d window
    const commitFrequency = commits90d != null
      ? parseFloat((commits90d / 13).toFixed(2)) // 13 weeks in the 90d window
      : null;

    // Round 24 (AutoResearch batch): fork-to-star ratio as ecosystem integration signal
    const forkStarRatio = stars > 0 ? forks / stars : null;

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
      has_ci: hasCI,
      latest_release: latestRelease,
      repo_health_tier: repoHealthTier,
      repo_health_score: repoHealthScore,
      fork_star_ratio: forkStarRatio != null ? Math.round(forkStarRatio * 1000) / 1000 : null,
      issue_star_ratio: issueStarRatio != null ? Math.round(issueStarRatio * 1000) / 1000 : null,
      issue_health_signal: issueHealthSignal,
      issue_resolution_rate: issueResolutionRate,
      commit_frequency: commitFrequency,
      // Round 215 (AutoResearch): contributor_bus_factor — risk when 1-2 contributors dominate activity
      // High bus factor = decentralized dev; low = single point of failure
      open_prs_count: openPrsCount,
      contributor_bus_factor: (() => {
        if (!Array.isArray(contributorStats) || contributorStats.length === 0) return null;
        // Calculate what % of commits the top contributor accounts for
        const totalCommits = contributorStats.reduce((s, c) => s + (c?.total || 0), 0);
        if (totalCommits === 0) return null;
        const sortedContribs = [...contributorStats].sort((a, b) => (b?.total || 0) - (a?.total || 0));
        const topPct = (sortedContribs[0]?.total || 0) / totalCommits;
        if (topPct > 0.8) return 'critical'; // 1 person = 80%+ of commits
        if (topPct > 0.6) return 'high';     // 1 person = 60%+ of commits
        if (topPct > 0.4) return 'moderate';
        return 'healthy'; // well-distributed contributions
      })(),
      // Round 210 (AutoResearch): has_recent_release — true if a release was published in last 90 days
      has_recent_release: latestRelease?.days_since_release != null
        ? latestRelease.days_since_release <= 90
        : null,
      // Round 204 (AutoResearch): days since last commit — quick staleness signal
      days_since_last_commit: (() => {
        const lastCommitDate = commitsData?.[0]?.commit?.author?.date;
        if (!lastCommitDate) return null;
        const days = Math.floor((Date.now() - new Date(lastCommitDate).getTime()) / 86400000);
        return days >= 0 ? days : null;
      })(),
      error: null,
    };
  } catch (error) {
    return {
      ...fallback,
      error: error.name === 'AbortError' ? 'GitHub timeout' : error.message,
    };
  }
}
