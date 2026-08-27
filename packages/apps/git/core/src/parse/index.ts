/**
 * com.ikenga.git · git-core — parser barrel.
 *
 * Every parser here is a PURE string → structure function. None of them
 * spawns, reads the filesystem, or knows what a repo is. That is what makes
 * the porcelain-format knowledge testable without git installed, and it is why
 * the fixtures in the tests next door can be pasted straight out of a terminal.
 */

export {
  countChanges,
  parseStatus,
  partitionChanges,
  type ParsedStatus,
} from './status.js';

export { branchOccupancy, mainWorktree, parseWorktreeList } from './worktree.js';

export {
  LOG_FIELD_COUNT,
  LOG_FIELD_COUNT_WITH_SIGNATURE,
  LOG_FORMAT,
  LOG_FORMAT_WITH_SIGNATURE,
  chunkNulRecords,
  parseCoAuthors,
  parseCommitDetail,
  parseDecorations,
  parseLog,
  parseTrailers,
  type Trailer,
} from './log.js';

export { mergeNumstat, parseNumstat, type NumstatEntry } from './numstat.js';

export { parseLeftRightCount, toAheadBehind, type LeftRightCount } from './revlist.js';

export { parseBranchList, parseTrack, toBranchInfo, type ParsedBranch } from './branch.js';
