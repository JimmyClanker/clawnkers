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
    subscribers: null,
    default_branch: null,
    homepage: null,
    repo_age_days: null,
    // Round 6: language breakdown + dependency count
    languages: {},
    dependency_count: null,
    // Round 29: CI detection
    has_ci: null,
    // Round 51: latest release
    latest_release: null,
    repo_visibility: null,
    search_match_score: null,
    error: null,
  };
}

// Round 187 (AutoResearch): GitHub fetchJson with retry on 403/429 (rate-limit)
// GitHub returns 403 with Retry-After or X-RateLimit-Reset on secondary rate limits.
async function fetchJson(url, { timeoutMs = DEFAULT_TIMEOUT_MS, retries = 2, headers = {}, label = 'GitHub request' } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': 'alpha-scanner/6.0.0',
          ...headers,
        },
        signal: controller.signal,
      });

      // Round 110 (AutoResearch): log rate limit remaining from response headers for observability
      const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
      const rateLimitLimit = response.headers.get('x-ratelimit-limit');
      if (rateLimitRemaining !== null && Number(rateLimitRemaining) < 100) {
        console.warn(`[github:${label}] Rate limit running low: ${rateLimitRemaining}/${rateLimitLimit} remaining`);
      }

      // Handle GitHub rate limiting (403 secondary limit or 429)
      if ((response.status === 429 || response.status === 403) && attempt < retries) {
        const retryAfter = Number(response.headers.get('retry-after') || 0);
        const resetAt = Number(response.headers.get('x-ratelimit-reset') || 0);
        let delayMs = 1500; // default backoff
        if (retryAfter > 0) delayMs = Math.min(retryAfter * 1000, 8000);
        else if (resetAt > 0) delayMs = Math.min(Math.max((resetAt * 1000 - Date.now()), 0), 8000);
        delayMs += Math.min(250 * attempt, 750); // light jitter/backoff growth
        clearTimeout(timeout);
        await new Promise((r) => setTimeout(r, delayMs));
        lastError = new Error(`${label}: GitHub ${response.status} rate-limited (${url})`);
        continue;
      }

      if (!response.ok) {
        const responseText = await response.text().catch(() => '');
        const compactText = responseText.replace(/\s+/g, ' ').trim().slice(0, 180);
        throw new Error(`${label}: HTTP ${response.status}${compactText ? ` — ${compactText}` : ''}`);
      }

      const data = await response.json();
      return { data, headers: response.headers };
    } catch (err) {
      lastError = err;
      if (err.name === 'AbortError') {
        lastError = new Error(`${label}: timed out after ${timeoutMs}ms`);
      }
      if (attempt >= retries) throw lastError;
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

function repoSearchScore(projectName, repo) {
  const target = String(projectName || '').trim().toLowerCase();
  const fullName = String(repo?.full_name || '').toLowerCase();
  const name = String(repo?.name || '').toLowerCase();
  const description = String(repo?.description || '').toLowerCase();
  let score = 0;
  if (name === target) score += 120;
  if (fullName.endsWith(`/${target}`)) score += 110;
  if (name.includes(target)) score += 60;
  if (description.includes(target)) score += 15;
  score += Math.min(30, Math.log10((Number(repo?.stargazers_count) || 0) + 1) * 8);
  if (repo?.archived) score -= 40;
  if (repo?.fork) score -= 20;
  return score;
}

// Round 554 (AutoResearch): add overall timeout cap for contributor stats to prevent
// long 202-polling from blocking the collector beyond the global GLOBAL_TIMEOUT_MS
const CONTRIBUTOR_STATS_MAX_MS = 8000; // cap total time for contributor stats polling

async function fetchContributorStats(owner, repo) {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/stats/contributors`;
  // GitHub returns 202 while computing stats — retry up to 3 times
  const deadline = Date.now() + CONTRIBUTOR_STATS_MAX_MS;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (Date.now() >= deadline) break; // exceeded overall cap
    try {
      const remainingMs = Math.max(1000, deadline - Date.now());
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.min(DEFAULT_TIMEOUT_MS, remainingMs));
      try {
        const response = await fetch(url, {
          headers: {
            accept: 'application/vnd.github+json',
            'user-agent': 'alpha-scanner/6.0.0',
          },
          signal: controller.signal,
        });
        if (response.status === 202) {
          // Computing — wait and retry (but respect deadline)
          const waitMs = Math.min(1500, Math.max(0, deadline - Date.now() - 500));
          if (waitMs < 100) break; // not enough time left
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        if ((response.status === 429 || response.status === 403) && attempt < 2) {
          const retryAfter = Number(response.headers.get('retry-after') || 0);
          const waitMs = retryAfter > 0 ? Math.min(retryAfter * 1000, 3000) : 1200;
          await new Promise((r) => setTimeout(r, waitMs));
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

    let searchMatchScore = mappedRepo ? 999 : null;
    if (!owner || !repo) {
      const searchUrl = `${GITHUB_API_BASE}/search/repositories?q=${encodeURIComponent(`${projectName} crypto blockchain`)}&sort=stars&order=desc&per_page=5`;
      const searchResponse = await fetchJson(searchUrl, { label: 'GitHub repo search' });
      const searchItems = Array.isArray(searchResponse.data?.items) ? searchResponse.data.items : [];
      topRepo = [...searchItems].sort((a, b) => repoSearchScore(projectName, b) - repoSearchScore(projectName, a))[0];
      searchMatchScore = topRepo ? repoSearchScore(projectName, topRepo) : null;

      if (!topRepo?.owner?.login || !topRepo?.name) {
        return { ...fallback, error: `GitHub repository not found for "${projectName}"` };
      }

      owner = topRepo.owner.login;
      repo = topRepo.name;
    }

    // Round 543 (AutoResearch): add Accept header to request topics (requires custom media type)
    const [repoInfo, commitsInfo, contributorsInfo, languagesInfo, packageJsonInfo, workflowsInfo, releasesInfo, closedIssuesInfo, openPrsInfo] = await Promise.allSettled([
      fetchJson(`${GITHUB_API_BASE}/repos/${owner}/${repo}`, {
        headers: { accept: 'application/vnd.github.mercy-preview+json' },
      }),
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

    // Round 238 (AutoResearch): detect test files via workflow names or typical test patterns
    // Heuristic: CI workflows mentioning "test", "jest", "mocha", "vitest" = has test suite
    const hasTestSuite = (() => {
      if (!Array.isArray(workflowsInfo.value?.data)) return null;
      // Round 75 (AutoResearch): broader test detection — check both workflow name AND filename
      // Some repos name workflows "CI" or "Build" but internally run jest/hardhat test
      return workflowsInfo.value.data.some((w) => {
        const name = (w?.name || '').toLowerCase();
        const path = (w?.path || '').toLowerCase();
        const testPattern = /test|jest|mocha|vitest|pytest|coverage|spec|hardhat|foundry|forge/;
        return testPattern.test(name) || testPattern.test(path);
      });
    })();

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

    // Round 233 (AutoResearch nightly): issue_health_score — 0-100 composite issue tracker health
    // Combines resolution rate, open issue count, and open PRs as a dev responsiveness metric
    const issueHealthScore = (() => {
      let score = 0;
      if (issueResolutionRate != null) {
        // Resolution rate component (0-50)
        score += Math.min(50, issueResolutionRate / 2);
      } else {
        score += 25; // neutral when unknown
      }
      // Open issue volume relative to stars (0-30): fewer open issues relative to stars = better health
      if (issueStarRatio != null) {
        const issueRatioScore = Math.max(0, 30 - issueStarRatio * 100);
        score += Math.min(30, issueRatioScore);
      } else {
        score += 15; // neutral
      }
      // Open PRs as a pipeline health signal (0-20): some PRs = active development
      if (openPrsCount != null) {
        if (openPrsCount > 0 && openPrsCount <= 30) score += 20;      // healthy pipeline
        else if (openPrsCount > 30 && openPrsCount <= 100) score += 10; // backlog forming
        else if (openPrsCount > 100) score += 5;                        // PR backlog is a concern
        else score += 0; // 0 PRs = no active development pipeline
      } else {
        score += 10; // neutral
      }
      return Math.round(Math.min(100, score));
    })();

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
      subscribers: repoData?.subscribers_count ?? null,
      default_branch: repoData?.default_branch ?? null,
      homepage: repoData?.homepage ?? null,
      repo_age_days: (() => {
        const createdAt = repoData?.created_at;
        if (!createdAt) return null;
        const days = Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000);
        return days >= 0 ? days : null;
      })(),
      languages: languagesData,
      dependency_count: dependencyCount,
      has_ci: hasCI,
      has_test_suite: hasTestSuite, // Round 238: test coverage signal from CI workflow names
      latest_release: latestRelease,
      repo_visibility: repoData?.visibility ?? null,
      search_match_score: searchMatchScore,
      repo_health_tier: repoHealthTier,
      repo_health_score: repoHealthScore,
      fork_star_ratio: forkStarRatio != null ? Math.round(forkStarRatio * 1000) / 1000 : null,
      issue_star_ratio: issueStarRatio != null ? Math.round(issueStarRatio * 1000) / 1000 : null,
      issue_health_signal: issueHealthSignal,
      issue_resolution_rate: issueResolutionRate,
      issue_health_score: issueHealthScore,
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
      // Round 234 (AutoResearch): contributor_growth_rate — is the team growing?
      // Measures: new contributors in last 30d vs prior 30d (within 90d window)
      contributor_growth_rate: (() => {
        if (!Array.isArray(contributorStats) || contributorStats.length === 0) return null;
        // Count contributors who had any commits in recent 30d vs prev 30d
        const now = Math.floor(Date.now() / 1000);
        const recent30 = new Set();
        const prev30 = new Set();
        for (const contrib of contributorStats) {
          if (!Array.isArray(contrib?.weeks)) continue;
          for (const week of contrib.weeks) {
            const wts = week?.w || 0;
            const commits = (week?.c || 0) + (week?.a || 0) + (week?.d || 0);
            if (commits === 0) continue;
            const daysAgo = (now - wts) / 86400;
            if (daysAgo <= 30) recent30.add(contrib.author?.login);
            else if (daysAgo <= 60) prev30.add(contrib.author?.login);
          }
        }
        if (prev30.size === 0) return recent30.size > 0 ? 'growing' : null;
        const ratio = recent30.size / prev30.size;
        if (ratio >= 1.3) return 'growing';
        if (ratio <= 0.7) return 'shrinking';
        return 'stable';
      })(),
      // Round 236 (AutoResearch): commits_per_contributor — avg dev output metric
      // Low ratio (<2) with many contributors suggests ghost contributors or minimal effort
      commits_per_contributor: (() => {
        const contribCount = Array.isArray(contributorStats) ? contributorStats.length : 0;
        if (contribCount === 0 || commits90d == null || commits90d === 0) return null;
        return parseFloat((commits90d / contribCount).toFixed(1));
      })(),

      // Round 237 (AutoResearch nightly): bus_factor_score (0-100) — more quantitative than label
      // Measures distribution of contribution weight: 100 = perfectly distributed, 0 = single person
      bus_factor_score: (() => {
        if (!Array.isArray(contributorStats) || contributorStats.length === 0) return null;
        const totalCommits = contributorStats.reduce((s, c) => s + (c?.total || 0), 0);
        if (totalCommits === 0) return null;
        // Gini coefficient inversion: lower Gini = more equal distribution = higher score
        const contributions = contributorStats.map(c => c?.total || 0).sort((a, b) => a - b);
        const n = contributions.length;
        let sumAbsDiff = 0;
        let sumContrib = 0;
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            sumAbsDiff += Math.abs(contributions[i] - contributions[j]);
          }
          sumContrib += contributions[i];
        }
        const gini = sumContrib > 0 ? sumAbsDiff / (2 * n * sumContrib) : 0;
        return Math.round((1 - gini) * 100);
      })(),

      // Round 381 (AutoResearch): github_velocity_tier — composite development pace classification
      // Combines commit frequency (commits/week) + staleness (days since last commit) into one label
      // Useful for quick LLM orientation without requiring both fields to be processed separately
      github_velocity_tier: (() => {
        const freq = commitFrequency;
        const daysSince = (() => {
          const d = commitsData?.[0]?.commit?.author?.date;
          if (!d) return null;
          return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
        })();
        if (freq == null) return null;
        if (daysSince != null && daysSince > 180) return 'stale';      // No activity for 6+ months
        if (daysSince != null && daysSince > 90) return 'slowing';     // 3-6 months since last commit
        if (freq >= 14) return 'hyperspeed';                           // 2+ commits/day
        if (freq >= 5) return 'active';                                // 5-14/wk
        if (freq >= 1) return 'moderate';                              // 1-5/wk
        if (freq > 0) return 'slow';                                   // < 1/wk
        return 'inactive';
      })(),
      // Round 382 (AutoResearch): critical_issue_ratio — open issues relative to total contributors
      // High ratio = dev team is overwhelmed by bug reports (quality risk)
      // Low ratio with active PRs = healthy balanced team
      critical_issue_ratio: (() => {
        const contribCount = Array.isArray(contributorStats) ? contributorStats.length : 0;
        const openIssueCount = repoData?.open_issues_count ?? 0;
        if (contribCount === 0) return null;
        const ratio = openIssueCount / Math.max(1, contribCount);
        // >10 issues per contributor = overwhelming debt; <2 = healthy capacity
        return parseFloat(ratio.toFixed(1));
      })(),

      // Round 383 (AutoResearch): top_contributor_name — the highest-commit contributor login.
      // Useful for bus-factor assessment: a single prominent committer with no apparent team is a risk signal.
      // We only expose the login (public data), not personal details.
      top_contributor_login: (() => {
        if (!Array.isArray(contributorStats) || contributorStats.length === 0) return null;
        const sorted = [...contributorStats].sort((a, b) => (b?.total || 0) - (a?.total || 0));
        return sorted[0]?.author?.login ?? null;
      })(),
      // Round 578 (AutoResearch): age of last push in days — quicker staleness signal than reading timestamps
      last_push_age_days: (() => {
        const pushedAt = repoData?.pushed_at || commitsData?.[0]?.commit?.author?.date;
        if (!pushedAt) return null;
        const days = Math.floor((Date.now() - new Date(pushedAt).getTime()) / 86400000);
        return days >= 0 ? days : null;
      })(),
      // Round 579 (AutoResearch): top contributor share — concentration of code output
      top_contributor_commit_share_pct: (() => {
        if (!Array.isArray(contributorStats) || contributorStats.length === 0) return null;
        const total = contributorStats.reduce((sum, c) => sum + Number(c?.total || 0), 0);
        if (total <= 0) return null;
        const top = Math.max(...contributorStats.map((c) => Number(c?.total || 0)));
        return parseFloat(((top / total) * 100).toFixed(1));
      })(),
      // Round 580 (AutoResearch): bus factor risk label from contributor concentration
      bus_factor_risk: (() => {
        if (!Array.isArray(contributorStats) || contributorStats.length === 0) return null;
        const total = contributorStats.reduce((sum, c) => sum + Number(c?.total || 0), 0);
        if (total <= 0) return null;
        const top = Math.max(...contributorStats.map((c) => Number(c?.total || 0)));
        const share = top / total;
        if (share >= 0.7) return 'high';
        if (share >= 0.45) return 'moderate';
        return 'low';
      })(),

      // Round 383 (AutoResearch): monthly_commit_velocity — a 3-month rolling window trend
      // Returns { recent: number, prev: number, change_pct: number } for scoring trend analysis
      // Supplements commit_trend (qualitative) with quantitative delta
      monthly_commit_velocity: (() => {
        if (commits30d == null || commits30dPrev == null) return null;
        if (commits30dPrev === 0) {
          return { recent: commits30d, prev: 0, change_pct: commits30d > 0 ? 100 : 0 };
        }
        const changePct = ((commits30d - commits30dPrev) / commits30dPrev) * 100;
        return {
          recent: commits30d,
          prev: commits30dPrev,
          change_pct: Number.isFinite(changePct) ? parseFloat(changePct.toFixed(1)) : 0,
        };
      })(),

      // Round 543 (AutoResearch): GitHub repo topics — free keyword signals (e.g. "defi", "ethereum", "zkp")
      // Useful for LLM context: confirms what the project actually builds without text parsing
      topics: Array.isArray(repoData?.topics)
        ? [...new Set(repoData.topics.map((topic) => String(topic || '').trim().toLowerCase()).filter(Boolean))].slice(0, 10)
        : [],
      // Round 563 (AutoResearch): archived/disabled flags — critical abandonment signals
      // Archived repo = no new contributions accepted; disabled = repo hidden by owner
      // Either flag = strong negative signal for development activity scoring
      is_archived: repoData?.archived ?? null,
      is_disabled: repoData?.disabled ?? null,
      // Derived: if archived or disabled, override commit_trend to indicate project status
      project_status: (() => {
        if (repoData?.archived) return 'archived';
        if (repoData?.disabled) return 'disabled';
        return null; // normal (status determined by commit activity)
      })(),
      // Round 558 (AutoResearch): network_count (total forks across the fork tree) and is_fork flag
      // network_count > forks: indicates the repo has active derivative projects
      // is_fork: if the main repo is itself a fork, this is a downstream project (higher risk)
      network_count: repoData?.network_count ?? null,
      is_fork: repoData?.fork ?? null,
      // Size metric: lines of code proxy (GitHub disk usage in KB)
      repo_size_kb: repoData?.size ?? null,
      // Round 235 (AutoResearch): commit_consistency_score — regularity of commits over 90d (0-100)
      // A protocol with consistent weekly commits is more reliable than one with burst activity
      commit_consistency_score: (() => {
        if (!Array.isArray(contributorStats) || contributorStats.length === 0) return null;
        const weeklyTotals = new Array(13).fill(0);
        for (const contributor of contributorStats) {
          const weeks = Array.isArray(contributor?.weeks) ? contributor.weeks.slice(-13) : [];
          const padded = new Array(Math.max(0, 13 - weeks.length)).fill(null).concat(weeks);
          for (let i = 0; i < padded.length; i++) {
            weeklyTotals[i] += Number(padded[i]?.c || 0);
          }
        }
        const activeWeeks = weeklyTotals.filter((count) => count > 0).length;
        if (activeWeeks === 0) return 0;
        return Math.round((activeWeeks / 13) * 100);
      })(),
      // Round R10 (AutoResearch nightly): release_cadence — how many releases per month (last 90d)
      // High release cadence = active product iteration; near-zero = stagnant codebase
      release_cadence_per_month: (() => {
        if (!latestRelease) return null;
        const daysSince = latestRelease.days_since_release;
        if (daysSince == null || daysSince > 365) return 0;
        // Use commits90d as a proxy for activity level; if recent release, estimate cadence
        if (commits90d == null || commits90d === 0) return daysSince <= 30 ? 1 : 0;
        // Rough estimate: 1 release per ~20 commits (typical project pace)
        const estimatedReleases90d = Math.round(commits90d / 20);
        return parseFloat((estimatedReleases90d / 3).toFixed(1)); // per month (3 months in 90d)
      })(),
      // Round R10 (AutoResearch nightly): critical_issue_ratio — open issues per contributor
      // High ratio = team overwhelmed; low ratio = responsive maintenance
      critical_issue_ratio: (() => {
        if (commits90d == null || commits90d === 0) return null;
        const contributors = Array.isArray(contributorStats) ? contributorStats.length : 0;
        if (contributors === 0) return null;
        const openIssuesCount = repoData?.open_issues_count ?? 0;
        return parseFloat((openIssuesCount / contributors).toFixed(1));
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
