/**
 * GitHub File Structure API
 * Fetches the directory tree of a GitHub repository using Git Trees API
 * for efficient single-request fetching of large repositories
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

interface GitTreeItem {
  path: string;
  mode: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
  url: string;
}

interface GitTreeResponse {
  sha: string;
  url: string;
  tree: GitTreeItem[];
  truncated: boolean;
}

// Directories to exclude from tree building
const EXCLUDED_DIRS = new Set([
  ".git",
  ".github",
  "node_modules",
  ".next",
  "dist",
  "build",
  ".venv",
  "__pycache__",
  ".pytest_cache",
  "coverage",
  ".nyc_output",
  "vendor",
  ".cache",
  ".turbo",
]);

// Helper to get GitHub headers with authentication
function getGitHubHeaders(): HeadersInit {
  const headers: HeadersInit = {
    Accept: "application/vnd.github.v3+json",
  };

  // Try multiple env var names for GitHub token
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_PAT;

  if (token) {
    // Support both "token" and "Bearer" formats
    headers["Authorization"] =
      token.startsWith("ghp_") || token.startsWith("github_pat_")
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
      const hasToken =
        options.headers && (options.headers as Record<string, string>)["Authorization"];
      if (!hasToken) {
        throw new Error(
          `GitHub API rate limit exceeded. Add a GITHUB_TOKEN environment variable to increase limits. ` +
            `Reset at: ${resetDate?.toISOString() || "unknown"}`
        );
      }

      // If wait time is reasonable (< 5 seconds), wait and retry
      if (waitTime < 5000 && attempt < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, waitTime + 1000));
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
      await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      continue;
    }

    lastError = new Error(`GitHub API error: ${response.status}`);
  }

  throw lastError || new Error("Failed to fetch from GitHub API");
}

/**
 * Get the default branch for a repository
 */
async function getDefaultBranch(owner: string, repo: string): Promise<string> {
  const url = `https://api.github.com/repos/${owner}/${repo}`;
  const response = await fetchWithRetry(url, {
    headers: getGitHubHeaders(),
  });
  const data = await response.json();
  return data.default_branch || "main";
}

/**
 * Fetch the entire repository tree using Git Trees API (single request)
 * This is much more efficient than recursively calling the Contents API
 */
async function fetchGitTreeRecursive(
  owner: string,
  repo: string,
  branch?: string
): Promise<GitTreeResponse> {
  // Get default branch if not specified
  const targetBranch = branch || (await getDefaultBranch(owner, repo));

  // Use Git Trees API with recursive flag - fetches entire tree in one request
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${targetBranch}?recursive=1`;

  const response = await fetchWithRetry(url, {
    headers: getGitHubHeaders(),
  });

  return response.json();
}

/**
 * Check if a path should be excluded based on directory filters
 */
function shouldExcludePath(path: string): boolean {
  const parts = path.split("/");
  return parts.some((part) => EXCLUDED_DIRS.has(part.toLowerCase()));
}

/**
 * Convert flat tree items to GitHubFile format (legacy compatibility)
 */
async function fetchGitHubTree(
  owner: string,
  repo: string,
  path: string = ""
): Promise<GitHubFile[]> {
  try {
    const treeResponse = await fetchGitTreeRecursive(owner, repo);

    // Filter to only items at the requested path level
    const pathPrefix = path ? `${path}/` : "";
    const pathDepth = path ? path.split("/").length : 0;

    const items = treeResponse.tree
      .filter((item) => {
        // Must start with path prefix (or be at root if no path)
        if (path && !item.path.startsWith(pathPrefix) && item.path !== path) {
          return false;
        }
        if (!path && item.path.includes("/")) {
          // At root, only show top-level items
          return false;
        }
        if (path && item.path.startsWith(pathPrefix)) {
          // Check if it's a direct child (not nested deeper)
          const relativePath = item.path.slice(pathPrefix.length);
          if (relativePath.includes("/")) {
            return false;
          }
        }

        // Exclude filtered directories
        return !shouldExcludePath(item.path);
      })
      .map((item) => ({
        name: item.path.split("/").pop() || item.path,
        type: item.type === "tree" ? ("dir" as const) : ("file" as const),
        path: item.path,
        size: item.size,
      }));

    return items;
  } catch (error) {
    console.error("Error fetching GitHub tree:", error);
    throw error;
  }
}

/**
 * Build a hierarchical file tree from the flat Git tree
 * Uses a single API call and builds the tree in memory
 */
async function buildFileTree(
  owner: string,
  repo: string,
  path: string = "",
  depth: number = 0,
  maxDepth: number = 3
): Promise<FileTreeNode[]> {
  try {
    const treeResponse = await fetchGitTreeRecursive(owner, repo);

    // Filter and organize tree items
    const filteredItems = treeResponse.tree.filter((item) => {
      // Exclude filtered directories
      if (shouldExcludePath(item.path)) {
        return false;
      }

      // If path is specified, only include items under that path
      if (path && !item.path.startsWith(`${path}/`)) {
        return false;
      }

      // Respect max depth
      const itemDepth = item.path.split("/").length - (path ? path.split("/").length : 0);
      return itemDepth <= maxDepth;
    });

    // Build hierarchical tree structure
    const root: Map<string, FileTreeNode> = new Map();
    const nodeMap: Map<string, FileTreeNode> = new Map();

    // First pass: create all nodes
    for (const item of filteredItems) {
      const node: FileTreeNode = {
        name: item.path.split("/").pop() || item.path,
        type: item.type === "tree" ? "dir" : "file",
        path: item.path,
        size: item.size,
        children: item.type === "tree" ? [] : undefined,
      };
      nodeMap.set(item.path, node);
    }

    // Second pass: build parent-child relationships
    for (const item of filteredItems) {
      const node = nodeMap.get(item.path)!;
      const parentPath = item.path.split("/").slice(0, -1).join("/");

      if (parentPath && nodeMap.has(parentPath)) {
        const parent = nodeMap.get(parentPath)!;
        if (parent.children) {
          parent.children.push(node);
        }
      } else if (!parentPath || parentPath === path || !path) {
        // Top-level item (relative to the specified path)
        const basePath = path ? item.path.slice(path.length + 1) : item.path;
        if (!basePath.includes("/")) {
          root.set(item.path, node);
        }
      }
    }

    // Convert to array and sort (directories first, then alphabetically)
    return Array.from(root.values()).sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "dir" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  } catch (error) {
    console.error(`Error building tree for ${path}:`, error);
    return [];
  }
}

/**
 * Get key files (README, package.json, main source files)
 * Uses the efficient Git Trees API
 */
async function getKeyFiles(owner: string, repo: string): Promise<string[]> {
  const keyFilePatterns = [
    "readme.md",
    "readme",
    "readme.txt",
    "package.json",
    "setup.py",
    "pyproject.toml",
    "requirements.txt",
    "dockerfile",
    "docker-compose.yml",
    "docker-compose.yaml",
    ".env.example",
    "tsconfig.json",
    "webpack.config.js",
    "next.config.js",
    "next.config.mjs",
    "vite.config.js",
    "vite.config.ts",
    "cargo.toml",
    "go.mod",
    "makefile",
  ];

  try {
    const treeResponse = await fetchGitTreeRecursive(owner, repo);

    // Find top-level key files
    const topLevelFiles = treeResponse.tree
      .filter((item) => item.type === "blob" && !item.path.includes("/"))
      .map((item) => item.path);

    return topLevelFiles.filter((file) =>
      keyFilePatterns.some((pattern) => file.toLowerCase() === pattern)
    );
  } catch {
    return [];
  }
}

export {
  fetchGitHubTree,
  buildFileTree,
  getKeyFiles,
  getGitHubHeaders,
  fetchWithRetry,
  fetchGitTreeRecursive,
  getDefaultBranch,
};
export type { FileTreeNode, GitHubFile, GitTreeItem, GitTreeResponse };
