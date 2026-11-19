// Real Gemini answers captured on 2026-11-19 for the three sample letters,
// used to measure the answer check. Sealed text exactly as Gemini returned it.
// Captured by a probe against the dev server; dates in them match
// buildSamples({ year: 2026, month: 11, day: 19 }).

export interface CapturedAnswer {
  letter: 'rfe' | 'rent' | 'bursar'
  task: 'explain' | 'checklist' | 'draft'
  language: 'en' | 'es'
  answer: string
}

export const CAPTURED: CapturedAnswer[] = [
 {
  "letter": "rfe",
  "task": "explain",
  "language": "en",
  "answer": "### What this letter is and who sent it\nThis is a Request for Evidence (RFE) sent by the U.S. Citizenship and Immigration Services (USCIS) Potomac Service Center regarding Form I-765 for ⟦NAME_1⟧ (Receipt Number: ⟦RECEIPT_1⟧, A-Number: ⟦A_NUMBER_1⟧).\n\n### Why you received it\nUSCIS is reviewing your post-completion Optional Practical Training (OPT) application and determined that the current evidence is not sufficient to establish eligibility.\n\n### What it asks for\nYou must submit:\n1. A copy of Form I-20 endorsed by your Designated School Official within the last 30 days recommending post-completion OPT.\n2. A copy of your passport biographic page.\n3. Two passport-style photographs with your name and ⟦A_NUMBER_1⟧ written lightly on the back.\n4. A copy of your marriage certificate for your F-2 dependent spouse, ⟦NAME_2⟧.\n\nYou must include this notice with your response and mail it to the address listed at the top of the letter.\n\n### Deadline\nYour response must be received by December 16, 2026.\n\n### What happens if you do nothing\nIf USCIS does not receive the requested evidence by December 16, 2026, they will decide your application based on the existing record, and it may be denied.\n\n***\n\nPlease check anything about your immigration status with your school's international student office or a qualified immigration attorney."
 },
 {
  "letter": "rent",
  "task": "checklist",
  "language": "es",
  "answer": "La fecha límite para pagar es el November 24, 2026.\n\n- [ ] Reúna los detalles de su cuenta con Tenant ID: ⟦ACCOUNT_1⟧ y la referencia de la cuota ⟦ACCOUNT_2⟧.\n- [ ] Prepare el pago total de $1,525.00 ($1,450.00 de renta más $75.00 de cargo por mora bajo la sección 4 de su contrato).\n- [ ] Pague por el portal de residentes, mediante giro postal (money order) en la oficina, o con cheque a nombre de Maple Court Apartments.\n- [ ] Escriba su Tenant ID en el cheque si elige esa forma de pago.\n- [ ] Verifique si su número ⟦PHONE_2⟧ y correo ⟦EMAIL_1⟧ siguen siendo correctos para notificar cambios.\n\nAntes de enviar:\n- Compruebe que la cantidad total de $1,525.00 sea exacta.\n- Asegúrese de que el pago se complete antes del final del November 24, 2026.\n- Confirme que su Tenant ID ⟦ACCOUNT_1⟧ esté incluido en el método de pago seleccionado."
 },
 {
  "letter": "bursar",
  "task": "draft",
  "language": "en",
  "answer": "Subject: Registration Hold - Student Health Insurance Charge - ⟦NAME_1⟧ (Student ID: ⟦ACCOUNT_1⟧)\n\nDear Office of Student Accounts,\n\nI am writing regarding the registration hold placed on my student account for the spring term student health insurance charge of $1,286.00. \n\nI currently plan to [describe your choice, such as submit a waiver or pay the charge]. [Describe the document you are attaching, such as my waiver form and insurance policy details] for your review. \n\nCould you please confirm if my waiver is currently being processed and if there are any additional documents needed to release the registration hold before December 1, 2026?\n\nSincerely,\n\n⟦NAME_1⟧  \nStudent ID: ⟦ACCOUNT_1⟧  \nSEVIS ID: ⟦SEVIS_1⟧  \n\n***\n\n*Note: Please check anything about your immigration status with your school's international student office or a qualified immigration attorney.*"
 },
 {
  "letter": "rfe",
  "task": "explain",
  "language": "en",
  "answer": "### What this letter is and who sent it\nThis is a Request for Evidence (RFE) sent by the U.S. Citizenship and Immigration Services (USCIS) Potomac Service Center regarding Form I-765 for ⟦NAME_1⟧ (Receipt Number ⟦RECEIPT_1⟧, A-Number ⟦A_NUMBER_1⟧). \n\n### Why you received it\nUSCIS is reviewing your application for optional practical training and has determined that the current evidence is not sufficient to establish your eligibility.\n\n### What it asks for\nYou must submit:\n1. A copy of Form I-20 endorsed by your Designated School Official within the last 30 days, showing the post-completion OPT recommendation.\n2. A copy of your passport biographic page.\n3. Two passport-style photographs with your name and ⟦A_NUMBER_1⟧ written lightly on the back.\n4. A copy of your marriage certificate for your spouse, ⟦NAME_2⟧, who is listed as an F-2 dependent.\n\nInclude this notice with your response and send everything to the address listed on the letter.\n\n### Deadline\nYour response must be received by **December 16, 2026**.\n\n### What happens if you do nothing\nIf USCIS does not receive the requested evidence by the deadline, they will decide your application based on the existing record, and it may be denied.\n\n***\n\nPlease check anything about your immigration status with your school's international student office or a qualified immigration attorney."
 },
 {
  "letter": "rent",
  "task": "checklist",
  "language": "es",
  "answer": "La fecha límite para pagar es el 24 de noviembre de 2026.\n\n- [ ] Reúna el número de inquilino ⟦ACCOUNT_1⟧ y la referencia del libro mayor ⟦ACCOUNT_2⟧.\n- [ ] Prepare el pago por un total de $1,525.00 (que incluye la renta de $1,450.00 más el cargo por pago tardío de $75.00).\n- [ ] Pague a través del portal para residentes, con giro postal en la oficina, o con cheque a nombre de Maple Court Apartments escribiendo su Tenant ID.\n- [ ] Comuníquese a la oficina al teléfono ⟦PHONE_1⟧ si tiene problemas para pagar antes de la fecha límite para discutir un plan de pagos.\n- [ ] Informe a la administración si su teléfono ⟦PHONE_2⟧ o correo electrónico ⟦EMAIL_1⟧ han cambiado.\n\nAntes de enviar:\n- Verifique que el monto total sea exactamente $1,525.00.\n- Confirme que el pago se realice a más tardar el 24 de noviembre de 2026.\n- Asegúrese de incluir el Tenant ID ⟦ACCOUNT_1⟧ si paga con cheque."
 },
 {
  "letter": "bursar",
  "task": "draft",
  "language": "en",
  "answer": "Subject: Inquiry regarding registration hold and health insurance charge - ⟦NAME_1⟧ (Student ID: ⟦ACCOUNT_1⟧)\n\nDear Office of Student Accounts,\n\nI am writing regarding the letter dated November 18, 2026, about the registration hold and the $1,286.00 spring term charge on my student account (Student ID: ⟦ACCOUNT_1⟧). \n\nI am currently taking action regarding Option 1. Please find attached [describe the document you are attaching], which includes my current policy details and Member ID: ⟦ACCOUNT_2⟧ for your review. \n\nCould you please confirm whether my waiver submission is complete, or if any additional documents are required to remove the registration hold before December 1, 2026?\n\nThank you for your assistance.\n\nSincerely,\n\n⟦NAME_1⟧\nStudent ID: ⟦ACCOUNT_1⟧\n\n***\n\nNote to the reader: Please check anything about your immigration status with your school's international student office or a qualified immigration attorney."
 },
 {
  "letter": "rfe",
  "task": "checklist",
  "language": "en",
  "answer": "You must ensure USCIS receives your response by December 16, 2026.\n\n- [ ] Contact your Designated School Official to obtain a new Form I-20 endorsed for post-completion OPT within the last 30 days.\n- [ ] Make a clear copy of the biographic page of your passport.\n- [ ] Obtain two passport-style photographs and write your name and ⟦A_NUMBER_1⟧ lightly on the back of each.\n- [ ] Locate a copy of your marriage certificate showing your marriage to ⟦NAME_2⟧.\n- [ ] Gather this notice to send together with your requested evidence to the address listed on the letter.\n\nBefore you send:\n- Verify that all four requested items are included in your package.\n- Confirm that your name and ⟦A_NUMBER_1⟧ are written on the back of the photographs.\n- Check that the Form I-20 endorsement date is within 30 days of your submission.\n\nPlease check anything about your immigration status with your school's international student office or a qualified immigration attorney."
 },
 {
  "letter": "rent",
  "task": "explain",
  "language": "en",
  "answer": "### What this letter is and who sent it\nThis is a \"Notice of Past Due Rent and Late Fee\" sent by Maple Court Apartments Property Management Office to ⟦NAME_1⟧ (Tenant ID: ⟦ACCOUNT_1⟧).\n\n### Why you probably received it\nThe office's records show that this month's rent of $1,450.00 has not been received. A $75.00 late fee (ledger reference ⟦ACCOUNT_2⟧) has been added to your account per Section 4 of your lease.\n\n### What it asks for\nIt asks for the total amount now due of $1,525.00. You can pay this amount through the resident portal, by money order at the office, or by check payable to Maple Court Apartments with your Tenant ID written on it.\n\n### The deadline\nYou must pay the full amount by **November 24, 2026**.\n\n### What happens if you do nothing\nIf payment is not received by the deadline, Maple Court Apartments may issue a formal Notice to Vacate, as allowed by your lease and Texas law."
 },
 {
  "letter": "bursar",
  "task": "explain",
  "language": "en",
  "answer": "## What this letter is and who sent it\nThis is an official notice from the Office of Student Accounts and Student Health Insurance at Example State University, sent to ⟦NAME_1⟧.\n\n## Why you probably received it\nYou received this because you are an international student automatically enrolled in the university's Student Health Insurance Plan. A spring term charge of $1,286.00 was added to your account, and a financial hold was placed on your registration.\n\n## What it asks for\nYou must choose one of two options:\n* **Waive the plan:** Submit the online waiver form with your policy details and documents (using your current Member ID ⟦ACCOUNT_2⟧) if your existing health insurance meets university requirements.\n* **Keep the plan:** Pay the $1,286.00 charge or enroll in a payment plan.\n\n## Deadlines\n* **December 1, 2026:** Deadline to submit the online waiver form.\n* **December 9, 2026:** Deadline to pay the $1,286.00 charge or enroll in a payment plan.\n\n## What happens if you do nothing\nIf you do nothing, the financial hold will remain on your account. While the hold is active, you cannot register for spring classes, which may affect your full-time enrollment status.\n\n***\n\nPlease check anything about your immigration status with your school's international student office or a qualified immigration attorney."
 }
]
