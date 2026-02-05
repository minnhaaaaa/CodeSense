/**
 * GitHub File Structure API
 * Fetches the directory tree of a GitHub repository
 */

interface GitHubFile {
  name: string;
  type: "file" | "dir";
  path: string;
  size?: number;
}

interface FileTreeNode extends GitHubFile {
  children?: FileTreeNode[];
}

// Helper to get GitHub headers with authentication
function getGitHubHeaders(): HeadersInit {
  const headers: HeadersInit = {
    Accept: "application/vnd.github.v3+json",
  };
  
  // Try multiple env var names for GitHub token
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_PAT;
  
  if (token) {
    // Support both "token" and "Bearer" formats
    headers["Authorization"] = token.startsWith("ghp_") || token.startsWith("github_pat_") 
      ? `token ${token}` 
      : `Bearer ${token}`;
  }
  
  return headers;
}

// Helper to handle rate limiting with exponential backoff
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number = 3
): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch(url, options);
    
    if (response.ok) {
      return response;
    }
    
    // Check rate limit headers
    const remaining = response.headers.get("x-ratelimit-remaining");
    const resetTime = response.headers.get("x-ratelimit-reset");
    
    if (response.status === 403 && remaining === "0") {
      const resetDate = resetTime ? new Date(parseInt(resetTime) * 1000) : null;
      const waitTime = resetDate ? Math.max(0, resetDate.getTime() - Date.now()) : 60000;
      
      // If we have a token and still hit limits, or wait time is too long, throw immediately
      const hasToken = options.headers && (options.headers as Record<string, string>)["Authorization"];
      if (!hasToken) {
        throw new Error(
          `GitHub API rate limit exceeded. Add a GITHUB_TOKEN environment variable to increase limits. ` +
          `Reset at: ${resetDate?.toISOString() || "unknown"}`
        );
      }
      
      // If wait time is reasonable (< 5 seconds), wait and retry
      if (waitTime < 5000 && attempt < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, waitTime + 1000));
        continue;
      }
      
      throw new Error(
        `GitHub API rate limit exceeded even with authentication. ` +
        `Reset at: ${resetDate?.toISOString() || "unknown"}`
      );
    }
    
    if (response.status === 404) {
      throw new Error("Repository not found");
    }
    
    if (response.status === 401) {
      throw new Error("Invalid GitHub token. Please check your GITHUB_TOKEN environment variable.");
    }
    
    // For other errors, retry with backoff
    if (attempt < maxRetries - 1 && response.status >= 500) {
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      continue;
    }
    
    lastError = new Error(`GitHub API error: ${response.status}`);
  }
  
  throw lastError || new Error("Failed to fetch from GitHub API");
}

async function fetchGitHubTree(
  owner: string,
  repo: string,
  path: string = ""
): Promise<GitHubFile[]> {
  try {
    // GitHub API endpoint for getting contents
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

    const response = await fetchWithRetry(url, {
      headers: getGitHubHeaders(),
    });

    const data = await response.json();

    // Single file case
    if (!Array.isArray(data)) {
      return [];
    }

    // Filter out common non-essential directories
    const filtered = data.filter((item: any) => {
      const name = item.name.toLowerCase();
      const excluded = [
        ".git",
        ".github",
        "node_modules",
        ".next",
        "dist",
        "build",
        ".venv",
        "__pycache__",
        ".pytest_cache",
      ];
      return !excluded.some((ex) => name.includes(ex));
    });

    return filtered.map((item: any) => ({
      name: item.name,
      type: item.type === "dir" ? "dir" : "file",
      path: item.path,
      size: item.size,
    }));
  } catch (error) {
    console.error("Error fetching GitHub tree:", error);
    throw error;
  }
}

// Build tree recursively
async function buildFileTree(
  owner: string,
  repo: string,
  path: string = "",
  depth: number = 0,
  maxDepth: number = 3
): Promise<FileTreeNode[]> {
  if (depth > maxDepth) return [];

  try {
    const files = await fetchGitHubTree(owner, repo, path);

    const tree: FileTreeNode[] = [];

    for (const file of files) {
      if (file.type === "dir" && depth < maxDepth) {
        const children = await buildFileTree(owner, repo, file.path, depth + 1, maxDepth);
        tree.push({
          ...file,
          children,
        });
      } else {
        tree.push(file);
      }
    }

    return tree;
  } catch (error) {
    console.error(`Error building tree for ${path}:`, error);
    return [];
  }
}

// Get key files (README, package.json, main source files)
async function getKeyFiles(owner: string, repo: string): Promise<string[]> {
  const keyFiles = [
    "README.md",
    "README",
    "package.json",
    "setup.py",
    "pyproject.toml",
    "requirements.txt",
    "Dockerfile",
    "docker-compose.yml",
    ".env.example",
    "tsconfig.json",
    "webpack.config.js",
    "next.config.js",
  ];

  try {
    const files = await fetchGitHubTree(owner, repo, "");
    const fileNames = files.map((f) => f.name.toLowerCase());

    return keyFiles.filter((kf) => fileNames.some((fn) => fn === kf.toLowerCase()));
  } catch {
    return [];
  }
}

export { fetchGitHubTree, buildFileTree, getKeyFiles, getGitHubHeaders, fetchWithRetry };
export type { FileTreeNode, GitHubFile };
