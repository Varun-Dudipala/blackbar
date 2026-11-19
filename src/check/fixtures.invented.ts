// Statements that sound plausible for each sample letter but that the letter
// does not make. None contains a date, amount or reference number, so only
// the wording check can catch them. Used to count false passes: any of these
// marked as matched to the letter is a failure.

export const INVENTED: Record<'rfe' | 'rent' | 'bursar', string[]> = {
  rfe: [
    'You must also send a copy of your employment offer letter.',
    'USCIS will schedule an interview at the Potomac Service Center before deciding.',
    'If you miss the deadline, your OPT application will be approved automatically.',
    'Your Designated School Official must mail the evidence directly to USCIS.',
    'The passport-style photographs must be in color and taken within the last month.',
    'You must pay a new filing fee with your response.',
    'USCIS is reviewing your application for a green card.',
    'You can respond to this request by email instead of by mail.',
    'Your spouse must also submit their own Form I-765.',
    'This letter was sent by your school’s international student office.',
  ],
  rent: [
    'Your lease will be terminated immediately if you do not pay.',
    'The late fee doubles every week that the rent stays unpaid.',
    'You can pay the full amount in cash at the property management office.',
    'Maple Court Apartments will report the late payment to a credit bureau.',
    'The community manager will inspect your unit before the deadline.',
    'You must sign a new lease to set up a payment plan.',
    'The notice says that you have already been evicted.',
    'Your roommate is also responsible for the unpaid rent.',
    'The office will waive the late fee if you call before the deadline.',
  ],
  bursar: [
    'International students cannot waive the student health insurance plan.',
    'The hold stays on your account until the end of the spring term even if you pay.',
    'You must submit the waiver form in person at the Office of Student Accounts.',
    'Your student visa will be cancelled if you do not pay the charge.',
    'The university will charge you interest on the unpaid amount.',
    'The waiver requires a letter from an insurer in your home country.',
    'You can still register for spring classes while the hold is active.',
    'The charge covers dental and vision insurance.',
    'Your international student advisor will pay the charge for you.',
  ],
}
