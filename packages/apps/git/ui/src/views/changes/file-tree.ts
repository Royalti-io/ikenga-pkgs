import type { FileChange } from '../../app/rpc';

export type Section = 'staged' | 'unstaged' | 'untracked' | 'conflicted';

export interface FileTreeNode {
  id: string;
  name: string;
  path: string;
  isDir: boolean;
  file?: FileChange;
  section: Section;
  children: FileTreeNode[];
}

export function buildFileTree(files: FileChange[], section: Section): FileTreeNode[] {
  interface RawNode {
    name: string;
    path: string;
    isDir: boolean;
    file?: FileChange;
    childrenMap: Map<string, RawNode>;
  }

  const rootMap = new Map<string, RawNode>();

  for (const f of files) {
    const parts = f.path.split('/').filter(Boolean);
    let currentMap = rootMap;
    let currentPath = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isLast = i === parts.length - 1;

      let node = currentMap.get(part);
      if (!node) {
        node = {
          name: part,
          path: currentPath,
          isDir: !isLast,
          file: isLast ? f : undefined,
          childrenMap: new Map(),
        };
        currentMap.set(part, node);
      }
      currentMap = node.childrenMap;
    }
  }

  function convertAndCompact(raw: RawNode): FileTreeNode {
    let name = raw.name;
    let path = raw.path;
    let childrenMap = raw.childrenMap;

    // Compact single-child folder chains
    while (raw.isDir && childrenMap.size === 1) {
      const singleChild = Array.from(childrenMap.values())[0]!;
      if (!singleChild.isDir) break;
      name = `${name}/${singleChild.name}`;
      path = singleChild.path;
      childrenMap = singleChild.childrenMap;
    }

    const children = Array.from(childrenMap.values()).map(convertAndCompact);

    // Sort: directories first, then files
    children.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return {
      id: `${section}:${path}`,
      name,
      path,
      isDir: raw.isDir,
      file: raw.file,
      section,
      children,
    };
  }

  const result = Array.from(rootMap.values()).map(convertAndCompact);
  result.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return result;
}

export function countTreeFiles(nodes: FileTreeNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.isDir) {
      count += countTreeFiles(node.children);
    } else {
      count += 1;
    }
  }
  return count;
}
