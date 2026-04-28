// Map file extensions to Monaco language IDs
const EXT_TO_LANG: Record<string, string> = {
  py: 'python', js: 'javascript', ts: 'typescript', tsx: 'typescript', jsx: 'javascript',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp',
  java: 'java', go: 'go', rs: 'rust', rb: 'ruby',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  sql: 'sql', json: 'json', yaml: 'yaml', yml: 'yaml',
  md: 'markdown', html: 'html', css: 'css', scss: 'scss',
  dockerfile: 'dockerfile', makefile: 'makefile',
};

export function getMonacoLang(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return EXT_TO_LANG[ext] || ext;
}
