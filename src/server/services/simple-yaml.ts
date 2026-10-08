/**
 * Just enough YAML for plugin config files: the scalar keys directly under
 * each top-level section (`section:` then `  key: value`). Nested sections,
 * lists and multi-line values are ignored.
 */
export function topLevelSections(yaml: string): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {};
  let current: Record<string, string> | null = null;
  for (const line of yaml.split('\n')) {
    const top = line.match(/^([A-Za-z]\w*):\s*$/);
    if (top) {
      current = sections[top[1]] = {};
      continue;
    }
    if (/^\S/.test(line)) {
      current = null;
      continue;
    }
    const entry = line.match(/^ {2}(\w+):\s*(.*?)\s*$/);
    if (current && entry && entry[2] !== '') current[entry[1]] = entry[2].replace(/^['"]|['"]$/g, '');
  }
  return sections;
}
