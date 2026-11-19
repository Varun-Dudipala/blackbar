import type { Kind, Span } from './detectors'

export const KINDS: readonly Kind[] = [
  'SSN',
  'A_NUMBER',
  'SEVIS',
  'RECEIPT',
  'PASSPORT',
  'PHONE',
  'EMAIL',
  'DOB',
  'ADDRESS',
  'ZIP',
  'ACCOUNT',
  'NAME',
  'OTHER',
]

/** Plain-language names, used in bar labels for screen readers and tooltips. */
export const KIND_LABEL: Record<Kind, string> = {
  SSN: 'Social Security number',
  A_NUMBER: 'A-number',
  SEVIS: 'SEVIS ID',
  RECEIPT: 'USCIS receipt number',
  PASSPORT: 'Passport number',
  PHONE: 'Phone number',
  EMAIL: 'Email address',
  DOB: 'Date of birth',
  ADDRESS: 'Street address',
  ZIP: 'ZIP code',
  ACCOUNT: 'Account or case number',
  NAME: 'Name',
  OTHER: 'Personal detail',
}

export const SOURCE_LABEL: Record<Span['source'], string> = {
  pattern: 'Found by pattern check',
  model: 'Found by the on-device model',
  user: 'Blacked out by you',
}

export function isKind(value: string): value is Kind {
  return (KINDS as readonly string[]).includes(value)
}

/** Maps a label the model returned to a known kind; anything unexpected is OTHER. */
export function toKind(value: string): Kind {
  const v = value.trim().toUpperCase().replace(/[\s-]+/g, '_')
  if (isKind(v)) return v
  if (v === 'DATE_OF_BIRTH') return 'DOB'
  if (v === 'SEVIS_ID') return 'SEVIS'
  if (v === 'CASE_NUMBER' || v === 'ACCOUNT_NUMBER' || v === 'ID_NUMBER') return 'ACCOUNT'
  if (v === 'PERSON' || v === 'PERSON_NAME' || v === 'FULL_NAME') return 'NAME'
  return 'OTHER'
}

/** Label for a kind name read from a placeholder such as ⟦A_NUMBER_1⟧. */
export function kindLabelOf(kind: string): string {
  return isKind(kind) ? KIND_LABEL[kind] : 'Hidden detail'
}

/** A first guess for the kind of a hand-made bar; the reader can change it. */
export function guessKind(value: string): Kind {
  if (/@/.test(value)) return 'EMAIL'
  if (/\d/.test(value)) return 'ACCOUNT'
  if (/\b(?:Center|Centre|Office|University|College|School|Services?|Department|Apartments|Bank|Insurance|Company|Agency|Hospital|Clinic)\b/.test(value)) return 'OTHER'
  if (/^(\p{Lu}[\p{L}'-]+\s?){1,4}$/u.test(value.trim())) return 'NAME'
  return 'OTHER'
}
