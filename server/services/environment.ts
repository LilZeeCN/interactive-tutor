import { execFile } from 'child_process';

interface RuntimeInfo {
  name: string;
  installed: boolean;
  version: string | null;
  path: string | null;
}

const RUNTIMES = [
  'python3', 'python', 'node', 'npm', 'npx',
  'java', 'javac', 'go', 'rustc', 'cargo',
  'conda', 'pip', 'pip3',
  'gcc', 'g++', 'make', 'cmake',
  'docker', 'git',
];

// Cache results for 5 minutes
let cachedResult: RuntimeInfo[] | null = null;
let cacheExpiry = 0;
const CACHE_TTL = 5 * 60 * 1000;

function detectRuntimeAsync(name: string): Promise<RuntimeInfo> {
  return new Promise((resolve) => {
    execFile('sh', ['-c', `${name} --version 2>/dev/null`], { timeout: 5000 }, (verErr, stdout) => {
      if (verErr) {
        resolve({ name, installed: false, version: null, path: null });
        return;
      }
      const version = stdout.trim().split('\n')[0];
      execFile('which', [name], { timeout: 3000 }, (pathErr, pathStdout) => {
        resolve({
          name,
          installed: true,
          version,
          path: pathErr ? null : pathStdout.trim(),
        });
      });
    });
  });
}

export async function detectAllRuntimes(): Promise<RuntimeInfo[]> {
  if (cachedResult && Date.now() < cacheExpiry) {
    return cachedResult;
  }
  const results = await Promise.all(RUNTIMES.map(detectRuntimeAsync));
  cachedResult = results;
  cacheExpiry = Date.now() + CACHE_TTL;
  return results;
}

// Sync version for one-off use (backwards compat)
export function detectAllRuntimesSync(): RuntimeInfo[] {
  if (cachedResult && Date.now() < cacheExpiry) {
    return cachedResult;
  }
  // Fall back to running async and blocking — but only if no cache
  // This shouldn't happen in normal usage since routes are async
  throw new Error('Use detectAllRuntimes() (async) instead');
}

export function getSetupCommands(runtime: string, targetDir: string): { commands: string[]; description: string } {
  switch (runtime) {
    case 'python3':
    case 'python':
      return {
        commands: [
          `cd "${targetDir}" && python3 -m venv venv`,
          `source "${targetDir}/venv/bin/activate"`,
          'pip install --upgrade pip',
        ],
        description: '创建 Python 虚拟环境',
      };
    case 'node':
      return {
        commands: [
          `cd "${targetDir}" && npm init -y`,
          'npm install',
        ],
        description: '初始化 Node.js 项目',
      };
    case 'conda':
      return {
        commands: [
          `conda create -p "${targetDir}/env" python=3.11 -y`,
          `conda activate "${targetDir}/env"`,
        ],
        description: '创建 Conda 虚拟环境',
      };
    case 'go':
      return {
        commands: [
          `cd "${targetDir}" && go mod init project`,
        ],
        description: '初始化 Go 模块',
      };
    case 'rust':
    case 'cargo':
      return {
        commands: [
          `cd "${targetDir}" && cargo init`,
        ],
        description: '初始化 Rust 项目',
      };
    default:
      return { commands: [], description: '不支持的环境类型' };
  }
}
