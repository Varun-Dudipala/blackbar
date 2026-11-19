// Deterministic, on-device detectors for identifiers that commonly appear in
// official U.S. paperwork. No model and no network are involved here.
// Free-form items (people's names, unusual case numbers) are added later by the
// on-device model and merged through the same Span type with source "model".

export type Kind =
  | 'SSN'
  | 'A_NUMBER'
  | 'SEVIS'
  | 'RECEIPT'
  | 'PASSPORT'
  | 'PHONE'
  | 'EMAIL'
  | 'DOB'
  | 'ADDRESS'
  | 'ZIP'
  | 'ACCOUNT'
  | 'NAME'
  | 'OTHER'

export interface Span {
  start: number
  end: number
  kind: Kind
  text: string
  source: 'pattern' | 'model' | 'user'
}

interface Rule {
  kind: Kind
  re: RegExp
  // Index of the capture group holding the sensitive value. 0 means the whole match.
  group?: number
}

const MONTH =
  '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)'
const DATE = `(?:\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}|${MONTH}\\.?\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}\\s+${MONTH}\\.?,?\\s+\\d{4}|\\d{4}-\\d{2}-\\d{2})`
const STREET_SUFFIX =
  '(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln|Court|Ct|Way|Place|Pl|Parkway|Pkwy|Circle|Cir|Terrace|Ter|Highway|Hwy)'
const STATE =
  '(?:AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)'

const RULES: Rule[] = [
  // Social Security number, dashed form.
  { kind: 'SSN', re: /\b\d{3}-\d{2}-\d{4}\b/g },
  // Nine bare digits count as an SSN only when the text labels them as one.
  {
    kind: 'SSN',
    re: /\b(?:SSN|Social\s+Security(?:\s+(?:Number|No\.?|#))?)\s*[:#]?\s*(\d{9})\b/gi,
    group: 1,
  },
  // USCIS alien registration number.
  { kind: 'A_NUMBER', re: /\bA[- ]?\d{8,9}\b/g },
  // SEVIS ID.
  { kind: 'SEVIS', re: /\bN\d{10}\b/g },
  // USCIS receipt number.
  { kind: 'RECEIPT', re: /\b(?:EAC|WAC|LIN|SRC|NBC|MSC|IOE|YSC)\d{10}\b/g },
  // Passport number, only when labelled.
  {
    kind: 'PASSPORT',
    re: /\bPassport(?:\s+(?:Number|No\.?|#))?\s*[:#]?\s*((?=[A-Z]*\d)[A-Z0-9]{6,9})\b/gi,
    group: 1,
  },
  // Account, policy, case, reference or student ID numbers, only when labelled.
  // The value must contain a digit so a following word is never taken as the number.
  {
    kind: 'ACCOUNT',
    re: /\b(?:Account|Acct\.?|Policy|Case|Claim|Loan|Invoice|Confirmation|File|Ledger|Reference|Ref\.?|Student\s+ID|Member\s+ID|Tenant\s+ID)(?:\s+(?:reference|ref\.?))?(?:\s+(?:Number|No\.?|#))?\s*[:#]?\s*((?=[A-Z-]*\d)[A-Z0-9][A-Z0-9-]{4,19})\b/gi,
    group: 1,
  },
  { kind: 'EMAIL', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { kind: 'PHONE', re: /(?:\+?1[\s.-]?)?(?:\(\d{3}\)\s?|\b\d{3}[\s.-])\d{3}[\s.-]\d{4}\b/g },
  // A date is sensitive only when labelled as a date of birth. Other dates stay
  // visible on purpose: deadlines are what the reader needs to see.
  {
    kind: 'DOB',
    re: new RegExp(`\\b(?:DOB|D\\.O\\.B\\.|Date\\s+of\\s+Birth|Birth\\s*date|Born(?:\\s+on)?)\\s*[:#]?\\s*(${DATE})`, 'gi'),
    group: 1,
  },
  // Street address line, optionally with a unit.
  {
    kind: 'ADDRESS',
    re: new RegExp(
      `\\b\\d{1,6}\\s+(?:[A-Z][A-Za-z0-9.']*\\s+){1,4}${STREET_SUFFIX}\\b\\.?(?:,?\\s*(?:Apt|Apartment|Unit|Suite|Ste|#)\\.?\\s*[A-Za-z0-9-]+)?`,
      'g',
    ),
  },
  // ZIP code, only directly after a state abbreviation.
  { kind: 'ZIP', re: new RegExp(`\\b${STATE}\\s+(\\d{5}(?:-\\d{4})?)\\b`, 'g'), group: 1 },
]

// A name right after "Dear" or a label with a colon such as "Beneficiary:".
// The name itself must be two to four capitalised words.
const NAME_AFTER_LABEL =
  /(?:\b[Dd]ear|\b(?:[Bb]eneficiary|[Aa]pplicant|[Pp]etitioner|[Tt]enant|[Rr]esident|[Ss]tudent(?:\s+[Nn]ame)?|[Nn]ame|[Tt]o|[Aa]ttn\.?|[Pp]atient|[Ii]nsured|[Mm]ember(?:\s+[Nn]ame)?|[Aa]ccount\s+[Hh]older)\s*:)[ \t]+((?:(?:Mr|Ms|Mrs|Mx|Dr)\.?\s+)?\p{Lu}[\p{L}'’-]+(?:[ \t]+\p{Lu}[\p{L}'’-]+){1,3})(?=\s*[,:;\n]|\s*$)/gmu

// Words that follow "Dear" or "To:" but are not a person's name.
const NOT_A_NAME = /^(?:Sir|Madam|Sir or Madam|Student|Students|Resident|Residents|Customer|Applicant|Tenant|Member|Whom|To Whom|Parent|Parents|Friend|Colleague|Office|Department)\b/i

function findLabelledNames(text: string): Span[] {
  const names = new Set<string>()
  const re = new RegExp(NAME_AFTER_LABEL.source, NAME_AFTER_LABEL.flags)
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const name = match[1].replace(/^(?:Mr|Ms|Mrs|Mx|Dr)\.?\s+/, '').trim()
    if (!NOT_A_NAME.test(name) && !/\b(?:University|College|Office|Services|Department|Apartments|Center|Bank|Plan)\b/.test(name)) names.add(name)
  }
  // Every place a labelled name appears gets a bar, including the address block.
  const spans: Span[] = []
  for (const name of names) {
    let at = text.indexOf(name)
    while (at !== -1) {
      const before = text[at - 1]
      const after = text[at + name.length]
      if (!/[\p{L}\p{N}]/u.test(before ?? '') && !/[\p{L}\p{N}]/u.test(after ?? '')) {
        spans.push({ start: at, end: at + name.length, kind: 'NAME', text: name, source: 'pattern' })
      }
      at = text.indexOf(name, at + 1)
    }
  }
  return spans
}

/**
 * Removes overlaps. The longest span wins; ties go to the earliest start, then to
 * the rule listed first. Returns spans sorted by position.
 */
export function resolveOverlaps(spans: Span[]): Span[] {
  const ranked = spans
    .map((span, order) => ({ span, order }))
    .sort((a, b) => {
      const lenA = a.span.end - a.span.start
      const lenB = b.span.end - b.span.start
      if (lenA !== lenB) return lenB - lenA
      if (a.span.start !== b.span.start) return a.span.start - b.span.start
      return a.order - b.order
    })
  const kept: Span[] = []
  for (const { span } of ranked) {
    if (span.end <= span.start) continue
    const clash = kept.some((k) => span.start < k.end && k.start < span.end)
    if (!clash) kept.push(span)
  }
  return kept.sort((a, b) => a.start - b.start)
}

export interface DateHit {
  start: number
  end: number
  text: string
  /** True when the text labels this date as a date of birth. */
  birth: boolean
}

const BIRTH_LABEL = /(?:DOB|D\.O\.B\.|Date\s+of\s+Birth|Birth\s*date|Born(?:\s+on)?)\s*[:#]?\s*$/i

/**
 * Finds every written date. Dates matter in two directions: a labelled date of
 * birth is personal, every other date (deadlines above all) must stay readable.
 */
export function findDates(text: string): DateHit[] {
  const re = new RegExp(`\\b${DATE}\\b`, 'gi')
  const hits: DateHit[] = []
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const before = text.slice(Math.max(0, match.index - 30), match.index)
    hits.push({ start: match.index, end: match.index + match[0].length, text: match[0], birth: BIRTH_LABEL.test(before) })
  }
  return hits
}

/** True when the whole string is a single written date. */
export function isDateLike(value: string): boolean {
  return new RegExp(`^${DATE}$`, 'i').test(value.trim())
}

/** Finds pattern-based identifiers in `text`. Runs entirely on the device. */
export function detect(text: string): Span[] {
  const found: Span[] = []
  for (const rule of RULES) {
    const re = new RegExp(rule.re.source, rule.re.flags)
    let match: RegExpExecArray | null
    while ((match = re.exec(text)) !== null) {
      if (match[0].length === 0) {
        re.lastIndex += 1
        continue
      }
      const group = rule.group ?? 0
      const value = match[group]
      if (!value) continue
      const start = group === 0 ? match.index : match.index + match[0].lastIndexOf(value)
      found.push({ start, end: start + value.length, kind: rule.kind, text: value, source: 'pattern' })
    }
  }
  found.push(...findLabelledNames(text))
  return resolveOverlaps(found)
}
