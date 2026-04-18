import type { DiffFile } from '@butaosuinu/harness-shared'
import parseDiffLib from 'parse-diff'

type LibFile = ReturnType<typeof parseDiffLib>[number]

function mapStatus(file: LibFile): DiffFile['status'] {
  if (file.new) return 'added'
  if (file.deleted) return 'removed'
  if (file.from && file.to && file.from !== file.to) return 'renamed'
  return 'modified'
}

export function parseUnifiedDiff(diff: string): DiffFile[] {
  const files = parseDiffLib(diff)
  const out: DiffFile[] = []
  for (const f of files) {
    const filename = f.to && f.to !== '/dev/null' ? f.to : (f.from ?? '')
    if (!filename || filename === '/dev/null') continue
    const entry: DiffFile = {
      filename,
      status: mapStatus(f),
      additions: f.additions ?? 0,
      deletions: f.deletions ?? 0,
      patch: reconstructPatch(f),
    }
    if (f.from && f.from !== f.to && f.from !== '/dev/null') {
      entry.previousFilename = f.from
    }
    out.push(entry)
  }
  return out
}

function reconstructPatch(f: LibFile): string {
  const lines: string[] = []
  for (const chunk of f.chunks) {
    lines.push(chunk.content)
    for (const change of chunk.changes) {
      lines.push(change.content)
    }
  }
  return lines.join('\n')
}
