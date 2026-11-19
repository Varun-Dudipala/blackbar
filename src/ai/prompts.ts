// Every prompt Blackbar sends to a model, in one place. On-device prompts may
// contain the real letter (nothing leaves the device). Cloud prompts are built
// only from sealed text and go through the leak gate in cloud.ts.

export const LANGUAGES = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
  { code: 'te', name: 'Telugu', native: 'తెలుగు' },
  { code: 'zh-Hans', name: 'Chinese (Simplified)', native: '简体中文' },
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt' },
  { code: 'ko', name: 'Korean', native: '한국어' },
  { code: 'ar', name: 'Arabic', native: 'العربية' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)', native: 'Português' },
  { code: 'ne', name: 'Nepali', native: 'नेपाली' },
] as const

export type LanguageCode = (typeof LANGUAGES)[number]['code']

export const languageName = (code: LanguageCode) => LANGUAGES.find((l) => l.code === code)?.name ?? 'English'
export const isRtl = (code: LanguageCode) => code === 'ar'

// ---------- on-device ----------

export function findSensitivePrompt(chunk: string): string {
  return `You help a person hide their personal identifiers before they share a letter.
List every piece of text in the letter below that identifies the RECIPIENT or another private person:
- people's names (the recipient, family members, dependents);
- identity and account numbers of any kind: case, file, receipt, student, tenant, member, policy, ledger, invoice or reference numbers, passport, visa, A-number, SEVIS ID, Social Security number;
- the recipient's street address, unit number, phone number and email address;
- a date of birth.
Rules:
- Copy each value exactly as it is written in the letter, character for character. Do not reformat or explain.
- Do NOT list the sending organisation's own name, address, phone number or website.
- Do NOT list deadlines, notice dates or other dates, except a date of birth.
- Do NOT list money amounts, form names (like "Form I-765") or law citations.
- If nothing qualifies, return an empty list.

LETTER:
${chunk}`
}

export function glancePrompt(letter: string, todayIso: string): string {
  return `Read the official letter below and fill in the fields for a busy reader. Today is ${todayIso}.
- documentType: what kind of document this is, in a few plain words (for example "Request for evidence", "Late rent notice").
- sender: the organisation and office that sent it.
- summary: one plain sentence saying what the letter is about.
- asks: each thing the reader is asked to do, as short imperative phrases. Empty if nothing is asked.
- deadlines: each date by which the reader must act, as YYYY-MM-DD, with what is due. Only dates that appear in the letter. If a deadline is relative ("within 30 days of this notice"), work it out from the letter's own date. Do not include the notice date itself.
- amounts: each amount of money the reader owes or must pay, copied exactly as written (for example "$1,450.00"), with what it is for. Empty if none.
Use the letter only. Do not guess.

LETTER:
${letter}`
}

export const TRANSCRIBE_PROMPT = `Transcribe all text in this image of a letter exactly as printed.
Keep the original line breaks and spacing between paragraphs. Copy every number, letter and punctuation mark exactly; identifiers such as "N0012345678" use the digit zero.
Do not summarise, skip, translate or add anything. Output only the transcribed text.`

export function explainOnDevicePrompt(letter: string): string {
  return `Explain the official letter below to the person who received it, in plain English a newcomer to the United States can follow.
Write at most 180 words:
1. One or two sentences: what this letter is and who sent it.
2. A short list of what the reader needs to do, with any deadline and amount.
3. One sentence on what happens if they do nothing, only if the letter says so.
This is an explanation, not legal advice. If the letter concerns immigration status or a legal dispute, end by suggesting the school's international student office or a qualified attorney.

LETTER:
${letter}`
}

// ---------- cloud (sealed text only) ----------

export type CloudTask = 'explain' | 'checklist' | 'draft' | 'followup'

export const CLOUD_SYSTEM_INSTRUCTION = `You are Blackbar, a careful assistant that explains official letters (immigration, housing, university, banking, health insurance) to international students and immigrants in the United States.
The letter you receive has been redacted on the reader's device. Personal identifiers are replaced with placeholders such as ⟦NAME_1⟧, ⟦SSN_1⟧ or ⟦A_NUMBER_1⟧.
- Keep placeholders exactly as written, including the ⟦ ⟧ brackets, wherever you need to refer to that detail. The reader's device puts the real values back.
- Never guess, invent or ask for the hidden values.
- Explain and organise. Do not give legal advice, legal strategy or a judgment on the reader's legal position, even if asked. Where a question needs one, say plainly that you cannot make that judgment.
- Suggest a professional only when the request tells you to, in the words it gives. Otherwise do not add referrals or disclaimers; the app already shows one.
- Be calm, concrete and brief. Use short paragraphs and lists. Use Markdown headings and lists only; no tables, no HTML.
- Quote deadlines and amounts exactly as the letter gives them.`

export type Referral = 'immigration' | 'legal' | null

export interface CloudPromptInput {
  task: CloudTask
  sealedLetter: string
  language: LanguageCode
  /** Follow-ups only: the sealed question and the earlier sealed answer. */
  question?: string
  previousAnswer?: string
  /** Whether this answer should end with a referral, and which one. */
  referral?: Referral
}

const IMMIGRATION = /\b(?:USCIS|immigration|SEVIS|visa|I-20|I-765|I-797|OPT|CPT|F-1|F-2|J-1|H-1B|green card|DSO|international student|⟦(?:A_NUMBER|SEVIS|RECEIPT)_\d+⟧)/i

/** True when the letter concerns immigration status (an RFE, an I-20, SEVIS, OPT and similar). */
export function touchesImmigration(sealedLetter: string): boolean {
  return IMMIGRATION.test(sealedLetter)
}

const LEGAL_JUDGMENT =
  /\b(?:legal(?:ly)?|lawyer|attorney|sue|court|my rights|deport(?:ed|ation)?|out of status|lose my (?:status|visa)|evict(?:ed|ion)?|is (?:this|it) (?:legal|allowed|enforceable)|can they (?:evict|fire|deport|charge|cancel|deny|refuse|sue|take)|do i have to (?:pay|leave|move)|should i (?:sign|appeal|fight)|appeal|enforceable|fraud)\b/i

/** True when a follow-up asks for a judgment only a lawyer or advisor can make. */
export function asksForLegalJudgment(question: string): boolean {
  return LEGAL_JUDGMENT.test(question)
}

/**
 * The referral for one answer: once, on the first answer about a letter that
 * touches immigration status, and on a follow-up only when it asks for a
 * legal judgment.
 */
export function referralFor(task: CloudTask, sealedLetter: string, isFirstAnswer: boolean, question = ''): Referral {
  if (task === 'followup') return asksForLegalJudgment(question) ? (touchesImmigration(sealedLetter) ? 'immigration' : 'legal') : null
  return isFirstAnswer && touchesImmigration(sealedLetter) ? 'immigration' : null
}

const REFERRAL_TEXT: Record<Exclude<Referral, null>, string> = {
  immigration:
    "End with one sentence, and only one, suggesting the reader check anything about their immigration status with their school's international student office or a qualified immigration attorney. In a draft reply, put that sentence after the draft as a separate note to the reader, not inside the letter.",
  legal:
    'End with one sentence, and only one, saying this needs a judgment you cannot make and suggesting a qualified attorney (for housing, a local tenant rights organisation).',
}

const NO_REFERRAL =
  'Do not suggest contacting an office, advisor or attorney, and do not add a disclaimer: the app already shows one, and an earlier answer may already have pointed the reader to one.'

const referralLine = (r: Referral | undefined) => (r ? REFERRAL_TEXT[r] : NO_REFERRAL)

function languageLine(language: LanguageCode): string {
  return language === 'en'
    ? 'Write the answer in English.'
    : `Write the answer in ${languageName(language)}. Keep placeholders, dates, amounts, form names and office names exactly as in the letter.`
}

const TASK_TEXT: Record<Exclude<CloudTask, 'followup'>, string> = {
  explain: `Explain this letter in plain language. Cover: what it is and who sent it; why the reader probably received it; what it asks for; the deadline; what happens if they do nothing (only if the letter says). Under 250 words.`,
  checklist: `Turn this letter into a checklist of next steps. Start with one sentence naming the deadline. Then a Markdown task list ("- [ ] ...") in the order the reader should do things: documents to gather, forms, payments, who to contact. Each item one line, concrete. End with a short "Before you send" list of things to double-check. Under 220 words.`,
  draft: `Draft a short, polite reply the reader can send to the sender of this letter. Use the placeholders for the reader's name and any reference numbers so the device can fill them in. Acknowledge the letter, say what the reader is doing about it (leave clearly marked gaps like [describe the document you are attaching] where you cannot know), and ask any obvious clarifying question. Give a subject line first, then the body. Under 200 words.`,
}

export function buildCloudPrompt(input: CloudPromptInput): string {
  const letter = `LETTER (redacted on the reader's device):\n"""\n${input.sealedLetter}\n"""`
  if (input.task === 'followup') {
    const earlier = input.previousAnswer ? `\n\nYOUR EARLIER ANSWER:\n"""\n${input.previousAnswer}\n"""` : ''
    return `${letter}${earlier}\n\nTHE READER ASKS:\n"""\n${input.question ?? ''}\n"""\n\nAnswer the question using the letter. If the letter does not say, say so plainly. Under 200 words. ${referralLine(input.referral)} ${languageLine(input.language)}`
  }
  return `${letter}\n\n${TASK_TEXT[input.task]} ${referralLine(input.referral)} ${languageLine(input.language)}`
}

export const TASK_TITLE: Record<CloudTask, string> = {
  explain: 'Plain explanation',
  checklist: 'What to do next',
  draft: 'Draft reply',
  followup: 'Follow-up',
}
