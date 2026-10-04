import type { Check, Deployment, LocalStatus, Pipeline, PullDetails, PullRequest } from '../types'
import { verdict } from './parse'
import type { Said } from './parse'

/** What the band judges: the working tree, and the branch's PR with its checks and deployments. */
export type View = { local: LocalStatus; pr: PullRequest | null; pipeline: Pipeline | null; deployments: Deployment[] }

export type State =
  | 'CONFLICT'
  | 'UNPUSHED'
  | 'UNCOMMITTED'
  | 'BLOCKED'
  | 'CI RUNNING'
  | 'DRAFT'
  | 'PR OPEN'
  | 'NEEDS REVIEW'
  | 'READY'
  | 'CLEAN'

/** The badge of each state; a calm one leaves room for an overview instead of a list of blockers. */
export const LOOK: Record<State, { mark: string; color: string; isCalm?: boolean }> = {
  CONFLICT: { mark: '✗', color: 'red' },
  UNPUSHED: { mark: '↑', color: 'yellow' },
  UNCOMMITTED: { mark: '✚', color: 'yellow' },
  BLOCKED: { mark: '✗', color: 'red' },
  'CI RUNNING': { mark: '●', color: 'yellow' },
  DRAFT: { mark: '◌', color: 'gray' },
  'PR OPEN': { mark: '#', color: 'blue' },
  'NEEDS REVIEW': { mark: '○', color: 'yellow' },
  READY: { mark: '✓', color: 'green', isCalm: true },
  CLEAN: { mark: '✓', color: 'green', isCalm: true },
}

/** Width in terminal cells, counting each code point as one. */
export const widthOf = (text: string) => [...text].length

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`
const changesOf = (local: LocalStatus) => local.staged + local.modified
const isUnpushed = (local: LocalStatus) => Boolean(local.branch) && (!local.upstream || local.ahead > 0)
const isConflicting = (details: PullDetails) => details.mergeable === 'CONFLICTING' || details.mergeState === 'DIRTY'
const wordOf = (pipeline: Pipeline | null) => (pipeline ? verdict(pipeline) : 'none')
const requestedChanges = (details: PullDetails) =>
  details.reviews.filter(review => review.state === 'CHANGES_REQUESTED').map(review => review.author)

/** The one word for where the branch stands, worst first. */
export function overallState({ local, pr, pipeline }: View): State {
  if (local.conflicted > 0) return 'CONFLICT'
  if (isUnpushed(local)) return 'UNPUSHED'
  if (!pr) return changesOf(local) > 0 ? 'UNCOMMITTED' : 'CLEAN'

  const word = wordOf(pipeline)
  const details = pr.details
  if (word === 'failed') return 'BLOCKED'
  if (
    details &&
    (details.reviewDecision === 'CHANGES_REQUESTED' || details.unresolvedThreads > 0 || isConflicting(details) || details.mergeState === 'BEHIND')
  ) {
    return 'BLOCKED'
  }
  if (word === 'running') return 'CI RUNNING'
  if (pr.isDraft) return 'DRAFT'
  if (!details) return 'PR OPEN'
  if (details.requested.length > 0 || details.reviewDecision === 'REVIEW_REQUIRED') return 'NEEDS REVIEW'
  if (details.mergeState === 'BLOCKED') return 'BLOCKED'
  if (details.mergeState === 'CLEAN' || details.mergeState === 'HAS_HOOKS') return 'READY'

  return 'PR OPEN'
}

/** What stands between the branch and a merge, in full or compact. */
export function blockers({ local, pr, pipeline, deployments }: View, compact: boolean): Said[] {
  const list: Said[] = []
  const add = (full: string, short: string, color?: string) => list.push(color ? { text: compact ? short : full, color } : { text: compact ? short : full })

  if (local.conflicted) add(`✗ ${plural(local.conflicted, 'file')} with local conflicts`, `✗${local.conflicted} conflicts`, 'red')
  if (local.branch && !local.upstream) add('not pushed yet', 'not pushed', 'yellow')
  else if (local.ahead) add(`↑${local.ahead} not pushed`, `↑${local.ahead}`, 'yellow')
  if (local.behind) add(`↓${local.behind} to pull`, `↓${local.behind}`, 'yellow')
  if (changesOf(local)) add(plural(changesOf(local), 'uncommitted change'), `✚${changesOf(local)}`, 'yellow')

  const word = wordOf(pipeline)
  if (pipeline && word === 'failed') {
    const failed = pipeline.checks.filter(check => check.state === 'failed')
    add(`✗ ${plural(pipeline.failed, 'check')} failed (${groupNames(failed).join(', ')})`, `✗ CI ${pipeline.failed}/${pipeline.total}`, 'red')
  } else if (pipeline && word === 'running') {
    add(`● checks running ${pipeline.passed}/${pipeline.total}`, `● CI ${pipeline.passed}/${pipeline.total}`, 'yellow')
  }

  if (pr?.isDraft) add('◌ draft', '◌ draft')
  const details = pr?.details
  if (pr && details) {
    if (details.reviewDecision === 'CHANGES_REQUESTED') {
      const by = requestedChanges(details)
      add(`✗ changes requested by ${by.join(', ') || '?'}`, `✗ changes ×${by.length || 1}`, 'red')
    }
    if (details.requested.length) add(`○ waiting for ${details.requested.join(', ')}`, `○ review ×${details.requested.length}`, 'yellow')
    else if (details.reviewDecision === 'REVIEW_REQUIRED') add('○ review required', '○ review', 'yellow')
    if (details.unresolvedThreads) add(plural(details.unresolvedThreads, 'open thread'), plural(details.unresolvedThreads, 'thread'), 'yellow')
    if (isConflicting(details)) add(`✗ conflicts with ${pr.base}`, '✗ merge conflict', 'red')
    else if (details.mergeState === 'BEHIND') add(`↓ behind ${pr.base}`, '↓ behind', 'yellow')
  }

  for (const one of deployments) {
    if (one.isThisCommit && (one.state === 'failure' || one.state === 'error')) add(`${one.environment} ${one.state}`, `${one.environment} ✗`, 'red')
  }

  return list
}

const lineWidth = (texts: string[], gap: number) => texts.reduce((sum, text) => sum + widthOf(text), 0) + gap * Math.max(0, texts.length - 1)

/** The blockers in full when all fit, else compact, else as many compact ones as fit and the count of the rest for a `+N`. */
export function fitBlockers(full: Said[], compact: Said[], width: number, gap = 2): { shown: Said[]; hidden: number } {
  if (lineWidth(full.map(said => said.text), gap) <= width) return { shown: full, hidden: 0 }
  if (lineWidth(compact.map(said => said.text), gap) <= width) return { shown: compact, hidden: 0 }

  for (let n = compact.length - 1; n > 0; n -= 1) {
    const shown = compact.slice(0, n)
    const more = `+${compact.length - n}`
    if (lineWidth([...shown.map(said => said.text), more], gap) <= width) return { shown, hidden: compact.length - n }
  }

  return { shown: [], hidden: compact.length }
}

export type Step = { state: 'done' | 'failed' | 'warning' | 'waiting' | 'todo'; text: string; detail?: string; hint?: string }

const step = (state: Step['state'], text: string, detail?: string, hint?: string): Step => ({
  state,
  text,
  ...(detail ? { detail } : {}),
  ...(hint ? { hint } : {}),
})

/** What is done and what is left before the branch can merge, each step worded for its state. */
export function checklist({ local, pr, pipeline }: View): { title: string; items: Step[] } {
  const items: Step[] = [
    local.conflicted
      ? step('failed', `${plural(local.conflicted, 'file')} with local conflicts`, undefined, 'git status')
      : step('done', 'No local conflicts'),
    changesOf(local)
      ? step('warning', 'Uncommitted changes', plural(changesOf(local), 'file'), 'git commit')
      : step('done', 'Working tree clean'),
  ]
  if (!local.branch) return { title: `Detached at ${local.sha?.slice(0, 7) ?? '?'}`, items }

  if (!local.upstream) items.push(step('failed', 'Not pushed yet', undefined, `git push -u origin ${local.branch}`))
  else if (local.ahead) items.push(step('failed', `${plural(local.ahead, 'commit')} not pushed`, undefined, 'git push'))
  else if (local.behind) items.push(step('warning', `${plural(local.behind, 'commit')} to pull`, undefined, 'git pull'))
  else items.push(step('done', 'Pushed'))

  if (!pr) {
    if (local.branch === 'main' || local.branch === 'master') return { title: local.branch, items }
    items.push(step('todo', 'No pull request yet', undefined, 'gh pr create'))

    return { title: `To open a pull request for ${local.branch}`, items }
  }

  const title = `To merge #${pr.number} into ${pr.base}`
  items.push(pr.isDraft ? step('warning', `Pull request #${pr.number}`, 'draft', 'gh pr ready') : step('done', `Pull request #${pr.number}`))

  const word = wordOf(pipeline)
  if (!pipeline || word === 'none') items.push(step('done', 'No checks'))
  else if (word === 'failed') items.push(step('failed', `${pipeline.failed} of ${pipeline.total} checks failed`))
  else if (word === 'running') items.push(step('waiting', 'Checks running', `${pipeline.passed}/${pipeline.total}`))
  else items.push(step('done', 'Checks passed'))

  const details = pr.details
  if (!details) {
    items.push(step('todo', 'Review and merge state unknown'))

    return { title, items }
  }

  if (details.reviewDecision === 'CHANGES_REQUESTED') items.push(step('failed', 'Changes requested', requestedChanges(details).join(', ')))
  else if (details.requested.length) items.push(step('waiting', 'Waiting for review', details.requested.join(', ')))
  else if (details.reviewDecision === 'REVIEW_REQUIRED') items.push(step('waiting', 'Review required'))
  else if (details.reviewDecision === 'APPROVED') items.push(step('done', 'Approved'))
  else items.push(step('done', 'No review required'))

  items.push(details.unresolvedThreads ? step('failed', plural(details.unresolvedThreads, 'open thread')) : step('done', 'No open threads'))

  if (isConflicting(details)) items.push(step('failed', `Conflicts with ${pr.base}`, undefined, `git merge origin/${pr.base}`))
  else if (details.mergeState === 'BEHIND') items.push(step('warning', `Behind ${pr.base}`, undefined, `git pull --rebase origin ${pr.base}`))
  else items.push(step('done', `Up to date with ${pr.base}`))

  return { title, items }
}

export type CheckGroup = { name: string; checks: Check[]; state: Check['state']; failedTests: number; variants: string[] }

const RANK: Check['state'][] = ['failed', 'running', 'queued', 'passed', 'neutral', 'skipped']

/** Matrix runs such as `e2e (3/16)` under one name, in the order first seen, each taking its worst state. */
export function groupChecks(checks: Check[]): CheckGroup[] {
  const groups = new Map<string, CheckGroup>()

  for (const check of checks) {
    const match = /^(.+?) \((.+)\)$/.exec(check.name)
    const name = match?.[1] ?? check.name
    const group = groups.get(name) ?? { name, checks: [], state: 'skipped', failedTests: 0, variants: [] }
    group.checks.push(check)
    if (match?.[2]) group.variants.push(match[2])
    if (RANK.indexOf(check.state) < RANK.indexOf(group.state)) group.state = check.state
    group.failedTests += check.tests?.failed ?? 0
    groups.set(name, group)
  }

  return [...groups.values()]
}

/** `e2e ×11`, `lint`. */
export function groupNames(checks: Check[]): string[] {
  return groupChecks(checks).map(group => (group.checks.length > 1 ? `${group.name} ×${group.checks.length}` : group.name))
}

export type Reviewer = { name: string; state: 'approved' | 'changes' | 'commented' | 'pending'; comments: number }

const REVIEW_STATE: Record<string, Reviewer['state']> = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes' }

/** Everyone who reviewed or is asked to; asked again counts as pending. */
export function reviewersOf(details: PullDetails): Reviewer[] {
  const reviewers: Reviewer[] = details.reviews.map(review => ({
    name: review.author,
    state: details.requested.includes(review.author) ? 'pending' : (REVIEW_STATE[review.state] ?? 'commented'),
    // a snapshot from before comments were counted has none
    comments: review.comments ?? 0,
  }))
  for (const name of details.requested) {
    if (!reviewers.some(reviewer => reviewer.name === name)) reviewers.push({ name, state: 'pending', comments: 0 })
  }

  return reviewers
}

export function reviewTally(reviewers: Reviewer[]): Record<Reviewer['state'], number> {
  const tally = { approved: 0, changes: 0, commented: 0, pending: 0 }
  for (const reviewer of reviewers) tally[reviewer.state] += 1

  return tally
}

/** A piece of a line: the lower `priority`, the more it matters; 0 is essential. */
export type Segment = { priority: number; parts: Said[]; short?: Said[] }

/**
 * The segments that fit `width`: the least important go first, the last of equals before the first;
 * before anything of priority 2 or less goes, every segment takes its short form.
 * `hidden` counts the essential ones that still had to go.
 */
export function fitSegments(segments: Segment[], width: number, gap = 2): { segments: Said[][]; hidden: number } {
  const kept = [...segments]
  let isShort = false
  let hidden = 0
  const partsOf = (segment: Segment) => (isShort && segment.short ? segment.short : segment.parts)
  const total = () => lineWidth(kept.map(segment => partsOf(segment).map(part => part.text).join('')), gap)

  while (kept.length > 0 && total() > width) {
    const highest = Math.max(...kept.map(segment => segment.priority))
    if (highest <= 2 && !isShort && kept.some(segment => segment.short)) {
      isShort = true
      continue
    }
    const index = kept.map(segment => segment.priority).lastIndexOf(highest)
    if (highest === 0) hidden += 1
    kept.splice(index, 1)
  }

  return { segments: kept.map(partsOf), hidden }
}
