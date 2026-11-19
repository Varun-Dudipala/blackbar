// Three synthetic letters. Every person, number and address is invented and
// obviously fake (000- SSNs, example.com, "Sample"/"Example" surnames). Dates are
// placed relative to today so the deadlines always read as upcoming.

import { addDays, formatLong, localToday, toIso, type CalendarDate } from '../lib/dates'

export interface SampleLetter {
  id: 'rfe' | 'rent' | 'bursar'
  title: string
  from: string
  blurb: string
  text: string
  /** For tests and the e2e check: values that must end up behind a bar. */
  identifiers: string[]
  /** Identifiers no pattern can find; only the on-device model can bar them. */
  modelOnly: string[]
  /** The main deadline as YYYY-MM-DD. */
  deadline: string
}

export function buildSamples(today: CalendarDate = localToday()): SampleLetter[] {
  const d = (n: number) => formatLong(addDays(today, n))
  const iso = (n: number) => toIso(addDays(today, n))

  const rfe = `U.S. Citizenship and Immigration Services
Potomac Service Center (sample)
P.O. Box 0000, Example City, VA 00000

Notice Date: ${d(-6)}
Receipt Number: IOE0912345678
Form I-765, Application for Employment Authorization

Jordan Sample
123 Example Street, Apt 4B
San Jose, CA 95112

REQUEST FOR EVIDENCE

Beneficiary: Jordan Sample
A-Number: A123456789
SEVIS ID: N0012345678
Date of Birth: 01/02/1999

Dear Jordan Sample:

We are reviewing your Form I-765 for optional practical training. The evidence you submitted is not sufficient to establish eligibility. Please submit the following:

1. A copy of the Form I-20 endorsed by your Designated School Official within the last 30 days, showing the recommendation for post-completion OPT.
2. A copy of the biographic page of your passport.
3. Two passport-style photographs with your name and A-Number written lightly on the back.
4. Your spouse, Riley Sample, is listed as an F-2 dependent. Include a copy of your marriage certificate.

Your response must be received by ${d(27)}. Send this notice with your response to the address above. If we do not receive the requested evidence by that date, we will decide your application based on the record, and it may be denied.

If you have questions, call the USCIS Contact Center at 800-555-0100. You may also update your contact details at jordan.sample@example.com through your online account.

Sincerely,
Officer 1192
Potomac Service Center`

  const rent = `MAPLE COURT APARTMENTS
Property Management Office
900 Placeholder Boulevard, Austin, TX 78702
Office: (512) 555-0100

${d(-2)}

Priya Example
456 Sample Avenue, Unit 12C
Austin, TX 78701
Tenant ID: TEN-48213

NOTICE OF PAST DUE RENT AND LATE FEE

Dear Priya Example,

Our records show that your rent of $1,450.00 for this month has not been received. Under section 4 of your lease, a late fee of $75.00 has been added to your account (ledger reference MC2026-0417-12C).

Total now due: $1,525.00

Please pay the full amount by ${d(5)}, through the resident portal, by money order at the office, or by check payable to Maple Court Apartments. Write your Tenant ID on the check.

If payment is not received by that date, we may issue a formal Notice to Vacate as allowed by your lease and Texas law. If you are having trouble paying, contact the office before the deadline to discuss a payment plan.

We have your phone on file as (512) 555-0187 and email as priya.example@example.com. Let us know if these have changed.

Thank you,
Dana Placeholder
Community Manager`

  const bursar = `EXAMPLE STATE UNIVERSITY
Office of Student Accounts and Student Health Insurance
1 University Way, Example Town, OH 00000

Date: ${d(-1)}

To: Wei Example
Student ID: 900123456
SEVIS ID: N0098765432
Date of Birth: 03/14/2001

Subject: Registration hold - student health insurance charge

Dear Wei Example,

All international students are enrolled automatically in the Example State University Student Health Insurance Plan. A charge of $1,286.00 for the spring term has been added to your student account, and a financial hold has been placed on your registration.

You have two options:

1. Waive the plan. If you already have health insurance that meets the university's requirements, submit the online waiver form with your policy details by ${d(12)}. Your current insurer lists you under Member ID: HX-55501234; include that policy's documents with the waiver.
2. Keep the plan. Pay the $1,286.00 charge, or enroll in a payment plan, by ${d(20)}.

The hold will be removed once a waiver is approved or the charge is paid. While the hold is active you cannot register for spring classes, which may affect your full-time enrollment status. Please talk to your international student advisor if you are concerned about enrollment.

Questions: studentaccounts@example.edu, (614) 555-0100.

Office of Student Accounts`

  return [
    {
      id: 'rfe',
      title: 'USCIS request for evidence',
      from: 'Immigration',
      blurb: 'An OPT work permit application needs more documents.',
      text: rfe,
      identifiers: ['IOE0912345678', 'Jordan Sample', 'A123456789', 'N0012345678', '01/02/1999', '123 Example Street, Apt 4B', '95112', 'jordan.sample@example.com', 'Riley Sample'],
      modelOnly: ['Riley Sample'],
      deadline: iso(27),
    },
    {
      id: 'rent',
      title: 'Past-due rent notice',
      from: 'Landlord',
      blurb: 'Rent plus a late fee, with a short deadline.',
      text: rent,
      identifiers: ['Priya Example', '456 Sample Avenue, Unit 12C', '78701', 'TEN-48213', 'MC2026-0417-12C', '(512) 555-0187', 'priya.example@example.com'],
      modelOnly: [],
      deadline: iso(5),
    },
    {
      id: 'bursar',
      title: 'University health-insurance hold',
      from: 'University',
      blurb: 'A registration hold until a fee is paid or waived.',
      text: bursar,
      identifiers: ['Wei Example', '900123456', 'N0098765432', '03/14/2001', 'HX-55501234'],
      modelOnly: [],
      deadline: iso(12),
    },
  ]
}
