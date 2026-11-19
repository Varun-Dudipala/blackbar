// Fixes for character confusions the on-device model makes when reading
// identifiers from images (measured in the lab: the SEVIS ID N0012345678 came
// back as "No0012345678" or "Noo12345678" in 4 of ~9 transcripts). Every change
// is reported so the reader can check it against the paper.

export interface OcrFix {
  from: string
  to: string
  index: number
  why: string
}

export function fixOcrConfusions(text: string): { text: string; fixes: OcrFix[] } {
  const fixes: OcrFix[] = []
  // SEVIS IDs: "N" then exactly ten digits. Letter o/O read in place of zeros.
  const sevis = /\bN([0oO]{1,4})(\d{5,10})\b/g
  const out = text.replace(sevis, (match, zeros: string, rest: string, index: number) => {
    if (!/[oO]/.test(zeros)) return match
    let digits = zeros.replace(/[oO]/g, '0') + rest
    // An inserted "o" makes one digit too many: drop one leading zero.
    if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
    if (digits.length !== 10) return match
    const fixed = `N${digits}`
    fixes.push({ from: match, to: fixed, index, why: 'SEVIS IDs are N followed by ten digits; the letter o was read in place of a zero.' })
    return fixed
  })
  return { text: out, fixes }
}
