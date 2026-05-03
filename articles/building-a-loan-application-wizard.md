# Building a Multi-Step Loan Application Wizard

This guide walks you through building a real-world 4-step loan application using the BFF boilerplate. You will create:

- A backend `SubmissionResource` with per-step validation, draft persistence, and version history
- A frontend wizard with step indicators, back/next navigation, and a read-only review screen before final submission
- Tests covering form rules and the full HTTP flow

The 4 steps:
| Step | Name | Fields |
|---|---|---|
| 1 | Personal info | Name, email, phone, address |
| 2 | Loan details | Type, amount, term, purpose |
| 3 | Financial info | Income source, monthly income/expenses, existing debt |
| 4 | Review & Submit | Read-only summary — no new input |

---

## Prerequisites

- Boilerplate running locally: `docker-compose up --build`
- API accessible at `http://localhost:3000`
- A valid JWT token (see [Getting a token](#getting-a-token) below)

---

## Architecture in 60 seconds

`SubmissionResource` stores all form data as JSONB in the shared `form_submissions` table — no separate domain table is needed. Each step is saved independently via `PATCH /:id/steps/:stepName`, which validates only that step's fields and merges the result. Final submission via `POST /:id/submit` runs full-form validation before marking the record as `submitted`.

```
POST   /loan-applications                        → create draft (step 1 data)
PATCH  /loan-applications/:id/steps/personal     → save step 1
PATCH  /loan-applications/:id/steps/loan         → save step 2
PATCH  /loan-applications/:id/steps/financial    → save step 3
POST   /loan-applications/:id/submit             → full validation → submitted
GET    /loan-applications/:id/history            → immutable version log
DELETE /loan-applications/:id                    → soft-delete (sets deleted_at)
```

---

## Step 1: Define the form

Create `server/src/resources/loans/form.ts`:

```ts
import {
  defineForm, text, email, number, select, textarea,
} from '../../core/form/index.js'

// All fields across all steps live in a single flat type.
// SubmissionResource stores everything in form_submissions.data (JSONB).
export interface LoanData {
  // Step 1 — personal info
  first_name:  string
  last_name:   string
  email:       string
  phone:       string
  address:     string
  // Step 2 — loan details
  loan_type:           string
  amount:              number
  term_months:         number
  purpose_description: string
  // Step 3 — financial info
  income_source:    string
  monthly_income:   number
  monthly_expenses: number
  existing_debt:    number
}

export const loanApplicationForm = defineForm<LoanData>(
  [
    // ── Step 1: Personal info ───────────────────────────────────────────────────
    text<LoanData>('first_name', { label: 'First name',  required: true, maxLength: 100 }),
    text<LoanData>('last_name',  { label: 'Last name',   required: true, maxLength: 100 }),
    email<LoanData>('email',     { label: 'Email',       required: true }),
    text<LoanData>('phone',      { label: 'Phone number', required: true, maxLength: 20 }),
    text<LoanData>('address',    { label: 'Address',     required: true, maxLength: 300 }),

    // ── Step 2: Loan details ────────────────────────────────────────────────────
    select<LoanData>('loan_type', {
      label:    'Loan purpose',
      required: true,
      options: [
        { value: 'home',       label: 'Home purchase'     },
        { value: 'car',        label: 'Car purchase'      },
        { value: 'renovation', label: 'Home renovation'   },
        { value: 'education',  label: 'Education'         },
        { value: 'other',      label: 'Other'             },
      ],
    }),
    number<LoanData>('amount', {
      label:    'Requested amount (PLN)',
      required: true,
      min:      1_000,
      max:      500_000,
    }),
    number<LoanData>('term_months', {
      label:    'Repayment period (months)',
      required: true,
      min:      6,
      max:      360,
    }),
    textarea<LoanData>('purpose_description', {
      label:     'Purpose description',
      maxLength: 1000,
      // Only required when loan_type is 'other'
      required:  (ctx) => ctx.values.loan_type === 'other',
    }),

    // ── Step 3: Financial info ──────────────────────────────────────────────────
    select<LoanData>('income_source', {
      label:    'Primary income source',
      required: true,
      options: [
        { value: 'employment', label: 'Employment contract' },
        { value: 'b2b',        label: 'Self-employed / B2B' },
        { value: 'pension',    label: 'Pension'              },
        { value: 'other',      label: 'Other'                },
      ],
    }),
    number<LoanData>('monthly_income', {
      label:    'Monthly net income (PLN)',
      required: true,
      min:      0,
    }),
    number<LoanData>('monthly_expenses', {
      label:    'Monthly fixed expenses (PLN)',
      required: true,
      min:      0,
    }),
    number<LoanData>('existing_debt', {
      label:    'Total existing debt (PLN)',
      required: true,
      min:      0,
    }),
    // Step 4 has no fields — the review UI is a custom read-only component.
  ],
  {
    steps: [
      { name: 'personal',  label: 'Personal info',   fields: ['first_name', 'last_name', 'email', 'phone', 'address'] },
      { name: 'loan',      label: 'Loan details',    fields: ['loan_type', 'amount', 'term_months', 'purpose_description'] },
      { name: 'financial', label: 'Financial info',  fields: ['income_source', 'monthly_income', 'monthly_expenses', 'existing_debt'] },
      { name: 'review',    label: 'Review & Submit', fields: [] },
    ],
    rules: [
      // Loan cannot exceed 5× annual income — checked at final submit
      {
        fields:     ['amount', 'monthly_income'],
        errorField: 'amount',
        validate: (v) => {
          const annual = (v.monthly_income as number ?? 0) * 12
          const amount = v.amount as number ?? 0
          if (amount > annual * 5) return 'Loan amount cannot exceed 5× annual income'
          return null
        },
      },
      // Monthly payment (rough estimate) cannot exceed 50% of net income
      {
        fields:     ['amount', 'term_months', 'monthly_income'],
        errorField: 'amount',
        validate: (v) => {
          const roughMonthlyPayment = (v.amount as number ?? 0) / (v.term_months as number ?? 1)
          const income = v.monthly_income as number ?? 0
          if (income > 0 && roughMonthlyPayment > income * 0.5)
            return 'Estimated monthly payment exceeds 50% of net income'
          return null
        },
      },
    ],
  },
)
```

> **Cross-field rules run only at final submit** (`POST /:id/submit`), not during per-step saves. This is intentional — the user hasn't entered their income yet when they fill in the loan amount.

---

## Step 2: Create the resource

Create `server/src/resources/loans/resource.ts`:

```ts
import type { Context } from 'hono'
import { SubmissionResource } from '../../core/submission/index.js'
import { loanApplicationForm } from './form.js'

export class LoanApplicationsResource extends SubmissionResource {
  readonly formName = 'loan_application'
  readonly form     = loanApplicationForm

  // Attach the authenticated user's ID as creator
  protected override getCreatedBy(ctx: Context): number | null {
    return (ctx.get('user') as { id: number } | undefined)?.id ?? null
  }
}
```

No model or schema migration needed — `SubmissionResource` uses the existing `form_submissions` table.

---

## Step 3: Register the resource

In `server/src/app.ts`, add two lines:

```ts
// At the top with other imports:
import { LoanApplicationsResource } from './resources/loans/resource.js'

// After the ResourceRegistry block, before mountAuditRoutes:
const loans = new LoanApplicationsResource()
loans.mount(app, '/loan-applications')
```

Restart the server — no migration needed.

---

## Step 4: Verify the API

### Getting a token

```bash
# The dev seed or your own POST /users endpoint
TOKEN="your.jwt.token"
AUTH="Authorization: Bearer $TOKEN"
```

### Walk through the full flow

```bash
# 1. Create a draft (first step data)
curl -s -X POST http://localhost:3000/loan-applications \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"data":{"first_name":"Jan","last_name":"Kowalski","email":"jan@example.com","phone":"500500500","address":"ul. Testowa 1, Warszawa"}}' \
  | jq .
# → { "ok": true, "data": { "id": 1, "status": "draft", "current_step": null, ... } }

ID=1

# 2. Save step 2 — loan details
curl -s -X PATCH http://localhost:3000/loan-applications/$ID/steps/loan \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"data":{"loan_type":"home","amount":300000,"term_months":240}}' \
  | jq .

# 3. Save step 3 — financial info
curl -s -X PATCH http://localhost:3000/loan-applications/$ID/steps/financial \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"data":{"income_source":"employment","monthly_income":8000,"monthly_expenses":2500,"existing_debt":0}}' \
  | jq .

# 4. Submit — runs full validation including cross-field rules
curl -s -X POST http://localhost:3000/loan-applications/$ID/submit \
  -H "$AUTH" \
  | jq .
# → { "ok": true, "data": { "status": "submitted", ... } }

# 5. Check version history
curl -s http://localhost:3000/loan-applications/$ID/history \
  -H "$AUTH" | jq .

# 6. Test a validation error — amount too high relative to income
curl -s -X PATCH http://localhost:3000/loan-applications/$ID/steps/loan \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"data":{"amount":999999}}' \
  | jq .
# Step save itself passes (cross-field rules only fire on submit).
# The submit endpoint will return:
# { "ok": false, "errors": { "amount": ["Loan amount cannot exceed 5× annual income"] } }
```

---

## Step 5: Frontend — the wizard page

### Install / confirm client deps

The frontend already has `WizardEngine` and `useWizardEngine`. No new packages needed.

### The page component

Create `client/src/pages/LoanApplicationPage.tsx`:

```tsx
import { useState } from 'react'
import { useWizardEngine } from '../react/useWizardEngine.js'
import type { LoanData } from '../../server-types.js' // copy LoanData interface here or redefine

export function LoanApplicationPage() {
  const {
    engine,
    state,
    errors,
    currentStep,
    currentStepIndex,
    currentStepFields,
    steps,
    isFirst,
    isLast,
    isSaving,
    isSubmitting,
  } = useWizardEngine<LoanData>({ endpoint: '/loan-applications' })

  const [values, setValues] = useState<Record<string, unknown>>({})
  const set = (k: string, v: unknown) => setValues(prev => ({ ...prev, [k]: v }))

  if (state === 'submitted') {
    return (
      <div className="wizard-success">
        <h2>Application submitted!</h2>
        <p>We will contact you within 2 business days.</p>
        <p>Reference number: <strong>#{engine.submissionId}</strong></p>
      </div>
    )
  }

  const busy = isSaving || isSubmitting

  return (
    <div className="wizard">
      {/* Step progress indicator */}
      <ol className="wizard-steps">
        {steps.map((s, i) => (
          <li
            key={s.name}
            className={
              i === currentStepIndex ? 'active' :
              i <  currentStepIndex ? 'done'   : ''
            }
          >
            <span className="step-number">{i + 1}</span>
            <span className="step-label">{s.label}</span>
          </li>
        ))}
      </ol>

      {/* Review step — custom read-only summary, no input fields */}
      {currentStep?.name === 'review' ? (
        <LoanReviewPanel
          values={engine.values as Partial<LoanData>}
          errors={errors}
          isSubmitting={isSubmitting}
          onBack={() => engine.prevStep()}
          onSubmit={() => engine.submitFinal({})}
        />
      ) : (
        /* All other steps — render form fields */
        <form
          onSubmit={e => {
            e.preventDefault()
            engine.nextStep(values as Partial<LoanData>)
          }}
          noValidate
        >
          {errors['_root']?.[0] && (
            <div role="alert" className="form-error">{errors['_root'][0]}</div>
          )}

          {currentStepFields.map(field => (
            <div key={field.name} className="form-field">
              <label htmlFor={field.name}>
                {field.label}
                {field.required && <span aria-hidden="true"> *</span>}
              </label>

              {field.type === 'select' ? (
                <select
                  id={field.name}
                  value={String(values[field.name] ?? '')}
                  onChange={e => set(field.name, e.target.value)}
                  required={field.required}
                >
                  <option value="">Select…</option>
                  {field.options?.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : field.type === 'textarea' ? (
                <textarea
                  id={field.name}
                  value={String(values[field.name] ?? '')}
                  onChange={e => set(field.name, e.target.value)}
                  required={field.required}
                />
              ) : (
                <input
                  id={field.name}
                  type={field.type === 'number' ? 'number' : field.type === 'email' ? 'email' : 'text'}
                  value={String(values[field.name] ?? '')}
                  onChange={e => set(field.name, field.type === 'number' ? Number(e.target.value) : e.target.value)}
                  required={field.required}
                  placeholder={field.placeholder}
                />
              )}

              {errors[field.name]?.[0] && (
                <span className="field-error">{errors[field.name][0]}</span>
              )}
            </div>
          ))}

          <div className="wizard-footer">
            {!isFirst && (
              <button type="button" onClick={() => engine.prevStep()} disabled={busy}>
                ← Back
              </button>
            )}
            <button type="submit" disabled={busy}>
              {isSaving ? 'Saving…' : 'Next →'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
```

> **Why `useWizardEngine` directly instead of `WizardController`?**
> Two reasons: (1) `WizardController` displays "Loading form…" when `currentStepFields` is empty — which is exactly what happens on the review step. (2) `WizardController` internally calls `useWizardEngine(engine.config)` passing the engine's private `config` field via a type cast — this creates a second engine instance. For any customised wizard, call `useWizardEngine` yourself.

---

## Step 6: The review panel

Create `client/src/pages/LoanReviewPanel.tsx`:

```tsx
import type { LoanData } from '../../server-types.js'

interface Props {
  values:       Partial<LoanData>
  errors:       Record<string, string[]>
  isSubmitting: boolean
  onBack:       () => void
  onSubmit:     () => void
}

const LOAN_TYPE_LABELS: Record<string, string> = {
  home:       'Home purchase',
  car:        'Car purchase',
  renovation: 'Home renovation',
  education:  'Education',
  other:      'Other',
}

const INCOME_SOURCE_LABELS: Record<string, string> = {
  employment: 'Employment contract',
  b2b:        'Self-employed / B2B',
  pension:    'Pension',
  other:      'Other',
}

function fmt(n: number | undefined) {
  return n !== undefined ? `${n.toLocaleString('pl-PL')} PLN` : '—'
}

export function LoanReviewPanel({ values, errors, isSubmitting, onBack, onSubmit }: Props) {
  const rootError = errors['_root']?.[0]
  const amountError = errors['amount']?.[0]

  return (
    <div className="review-panel">
      <h2>Review your application</h2>

      <section>
        <h3>Personal info</h3>
        <dl>
          <dt>Full name</dt><dd>{values.first_name} {values.last_name}</dd>
          <dt>Email</dt>    <dd>{values.email}</dd>
          <dt>Phone</dt>    <dd>{values.phone}</dd>
          <dt>Address</dt>  <dd>{values.address}</dd>
        </dl>
      </section>

      <section>
        <h3>Loan details</h3>
        <dl>
          <dt>Purpose</dt>       <dd>{LOAN_TYPE_LABELS[values.loan_type ?? ''] ?? values.loan_type}</dd>
          <dt>Amount</dt>        <dd>{fmt(values.amount)}</dd>
          <dt>Term</dt>          <dd>{values.term_months} months</dd>
          {values.purpose_description && (
            <><dt>Description</dt><dd>{values.purpose_description}</dd></>
          )}
        </dl>
        {amountError && <p className="field-error">{amountError}</p>}
      </section>

      <section>
        <h3>Financial info</h3>
        <dl>
          <dt>Income source</dt>   <dd>{INCOME_SOURCE_LABELS[values.income_source ?? ''] ?? values.income_source}</dd>
          <dt>Monthly income</dt>  <dd>{fmt(values.monthly_income)}</dd>
          <dt>Monthly expenses</dt><dd>{fmt(values.monthly_expenses)}</dd>
          <dt>Existing debt</dt>   <dd>{fmt(values.existing_debt)}</dd>
        </dl>
      </section>

      {rootError && <div role="alert" className="form-error">{rootError}</div>}

      <p className="review-disclaimer">
        By submitting you confirm the information above is accurate and complete.
      </p>

      <div className="wizard-footer">
        <button type="button" onClick={onBack} disabled={isSubmitting}>
          ← Back to edit
        </button>
        <button type="button" onClick={onSubmit} disabled={isSubmitting} className="btn-primary">
          {isSubmitting ? 'Submitting…' : 'Submit application'}
        </button>
      </div>
    </div>
  )
}
```

---

## Step 7: Adding auth headers

`WizardEngine`'s internal `fetch` calls send no `Authorization` header by default. For production you need to intercept them. The cleanest approach is to patch `window.fetch` before rendering, or use a request interceptor:

```ts
// client/src/core/auth.ts
const TOKEN_KEY = 'jwt_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

// Wrap native fetch once at app startup (main.tsx / index.tsx)
const _fetch = window.fetch.bind(window)
window.fetch = (input, init = {}) => {
  const token = getToken()
  if (token) {
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    return _fetch(input, { ...init, headers })
  }
  return _fetch(input, init)
}
```

Call this before rendering your app — all `WizardEngine` and `FormEngine` fetch calls will automatically include the token.

---

## Step 8: Resuming an in-progress draft

A user may close the browser mid-way. Let them resume:

```tsx
import { useEffect, useState } from 'react'
import { useWizardEngine } from '../react/useWizardEngine.js'

export function LoanApplicationPage() {
  const { engine, ...wizardState } = useWizardEngine<LoanData>({
    endpoint: '/loan-applications',
  })

  const [checked, setChecked] = useState(false)

  // On mount: look for an existing draft belonging to the user
  useEffect(() => {
    async function checkForDraft() {
      const res  = await fetch('/loan-applications?filter[status]=draft&pageSize=1')
      const json = await res.json()
      if (json.ok && json.data.length > 0) {
        const draft = json.data[0]
        // Load the draft — engine will resume at the saved step
        engine.load({ id: draft.id, data: draft.data, current_step: draft.current_step })
      }
      setChecked(true)
    }
    checkForDraft()
  }, [engine])

  if (!checked) return <div>Loading…</div>

  // Rest of the wizard render...
}
```

`engine.load()` sets `submissionId`, merges values, and sets `currentStepIndex` to the saved step. The wizard resumes exactly where the user left off.

---

## Step 9: Tests

### Form rules — no DB required

Create `server/src/__tests__/loan-form.test.ts`:

```ts
import { describe, test } from 'vitest'
import { FormTestKit } from '../core/testing/index.js'
import { loanApplicationForm } from '../resources/loans/form.js'

const valid: Record<string, unknown> = {
  first_name: 'Jan', last_name: 'Kowalski', email: 'jan@example.com',
  phone: '500500500', address: 'ul. Testowa 1',
  loan_type: 'home', amount: 100_000, term_months: 120,
  income_source: 'employment', monthly_income: 8_000,
  monthly_expenses: 2_000, existing_debt: 0,
}

describe('loanApplicationForm', () => {
  test('valid application passes', () => {
    FormTestKit.fill(loanApplicationForm, valid).expectValid()
  })

  test('missing required fields fail', () => {
    FormTestKit.fill(loanApplicationForm, { ...valid, first_name: '' })
      .expectInvalid()
      .expectError('first_name', 'required')
  })

  test('purpose_description required only when loan_type is other', () => {
    FormTestKit.fill(loanApplicationForm, { ...valid, loan_type: 'other', purpose_description: '' })
      .expectInvalid()
      .expectError('purpose_description', 'required')

    FormTestKit.fill(loanApplicationForm, { ...valid, loan_type: 'home', purpose_description: '' })
      .expectValid()
  })

  test('loan amount cannot exceed 5× annual income', () => {
    FormTestKit.fill(loanApplicationForm, { ...valid, amount: 500_000, monthly_income: 5_000 })
      .expectInvalid()
      .expectError('amount', '5×')
  })

  test('monthly payment cannot exceed 50% of income', () => {
    // 300k / 12 months = 25k/month > 50% of 8k income
    FormTestKit.fill(loanApplicationForm, { ...valid, amount: 300_000, term_months: 12 })
      .expectInvalid()
      .expectError('amount', '50%')
  })
})
```

Run with: `npm test` (no DB needed).

### Integration test — full HTTP flow

Create `server/src/__tests__/loans.integration.test.ts`:

```ts
import { describe, test, beforeEach, expect } from 'vitest'
import { seed, testDb, TestClient, createTestToken } from '../core/testing/index.js'
import { app } from '../app.js'

const hasDatabaseUrl = Boolean(process.env['DATABASE_URL'])

describe.skipIf(!hasDatabaseUrl)('LoanApplications integration', () => {
  const client = new TestClient(app)

  beforeEach(() => testDb.truncateAll())

  test('POST /loan-applications requires auth', async () => {
    const { res } = await client.post('/loan-applications').send({ data: {} }).json()
    expect(res.status).toBe(401)
  })

  test('creates a draft and progresses through all steps', async () => {
    const user  = await seed.createUser({ role: 'user' })
    const token = await createTestToken(user)

    // Step 1: Create draft
    const { res: r1, body: b1 } = await client.post('/loan-applications')
      .withToken(token)
      .send({ data: {
        first_name: 'Jan', last_name: 'Kowalski',
        email: 'jan@example.com', phone: '500500500', address: 'ul. Testowa 1',
      }}).json()
    expect(r1.status).toBe(201)
    expect(b1.data.status).toBe('draft')
    const id = b1.data.id as number

    // Step 2: Loan details
    const { res: r2 } = await client
      .patch(`/loan-applications/${id}/steps/loan`)
      .withToken(token)
      .send({ data: { loan_type: 'home', amount: 100_000, term_months: 120 } }).json()
    expect(r2.status).toBe(200)

    // Step 3: Financial info
    const { res: r3 } = await client
      .patch(`/loan-applications/${id}/steps/financial`)
      .withToken(token)
      .send({ data: { income_source: 'employment', monthly_income: 8_000, monthly_expenses: 2_000, existing_debt: 0 } }).json()
    expect(r3.status).toBe(200)

    // Submit — cross-field rules pass
    const { res: r4, body: b4 } = await client
      .post(`/loan-applications/${id}/submit`)
      .withToken(token).json()
    expect(r4.status).toBe(200)
    expect(b4.data.status).toBe('submitted')
  })

  test('submit fails when amount exceeds 5× annual income', async () => {
    const user  = await seed.createUser({ role: 'user' })
    const token = await createTestToken(user)

    const { body: draft } = await client.post('/loan-applications').withToken(token)
      .send({ data: { first_name: 'Jan', last_name: 'Kowalski', email: 'jan@example.com', phone: '500500500', address: 'ul. Testowa 1' }}).json()
    const id = draft.data.id as number

    await client.patch(`/loan-applications/${id}/steps/loan`).withToken(token)
      .send({ data: { loan_type: 'home', amount: 500_000, term_months: 120 } }).json()

    await client.patch(`/loan-applications/${id}/steps/financial`).withToken(token)
      .send({ data: { income_source: 'employment', monthly_income: 5_000, monthly_expenses: 1_000, existing_debt: 0 } }).json()

    const { res, body } = await client.post(`/loan-applications/${id}/submit`).withToken(token).json()
    expect(res.status).toBe(422)
    expect(body.errors.amount[0]).toMatch(/5×/)
  })

  test('soft-deletes on DELETE', async () => {
    const user  = await seed.createUser({ role: 'user' })
    const token = await createTestToken(user)

    const { body: draft } = await client.post('/loan-applications').withToken(token)
      .send({ data: { first_name: 'A', last_name: 'B', email: 'a@b.com', phone: '1', address: 'x' } }).json()
    const id = draft.data.id as number

    const { res: delRes } = await client.delete(`/loan-applications/${id}`).withToken(token).json()
    expect(delRes.status).toBe(204)

    // Record still exists in DB but is excluded from list
    const { body: list } = await client.get('/loan-applications').withToken(token).json()
    expect(list.data.find((r: { id: number }) => r.id === id)).toBeUndefined()
  })
})
```

Run integration tests:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/bff_db \
JWT_SECRET=test-secret \
npm test
```

---

## Admin panel: backend readiness

If you also need an **admin view** of loan applications (list all, view details, change status), the backend is fully ready:

```bash
GET  /loan-applications                           # paginated list
GET  /loan-applications?filter[status]=submitted  # filter by status
GET  /loan-applications?sort=-created_at          # newest first
GET  /loan-applications/:id                       # detail
GET  /loan-applications/:id/history               # full audit trail
POST /loan-applications/:id/lock                  # submitted → locked
POST /loan-applications/:id/archive               # → archived
```

The only frontend piece you need to build is a table/list component — the BFF boilerplate does not include one. A minimal approach:

```tsx
// Fetch and display
const res  = await fetch('/loan-applications?pageSize=50&sort=-created_at')
const json = await res.json()
// json.data  → array of submissions
// json.meta  → { total, page, pageSize, hasNext }
```

Use the `meta.hasNext` flag for pagination controls. Each row links to a detail page that uses `FormEngine` in read-only display mode.

---

## Before going to production

The boilerplate is not production-ready out of the box. Before deploying:

| What | Why | Fix |
|---|---|---|
| No authorization layer | Any authenticated user can read/modify any submission, including other users' loan applications | Override `beforeList` / `beforeCreate` / `beforeDelete` in `LoanApplicationsResource` to filter by `created_by === ctx.get('user').id`; restrict admin endpoints to `role === 'admin'` |
| No CORS config | Browser requests from a different origin will be blocked | `app.use('*', cors({ origin: process.env['ALLOWED_ORIGINS'] }))` |
| No rate limiting | Brute-force / DoS exposure | Add `@hono/rate-limit` or an Nginx layer |
| No request body size limit | Large payloads can exhaust memory | Add Hono `bodyLimit` middleware (e.g. 1 MB) |
| `/audit` is open to all users | Information disclosure | Restrict to `role === 'admin'` in `mountAuditRoutes` |
| No structured logging | Can't debug production incidents | Replace `console.error` with `pino` or similar |
| Auth headers in WizardEngine | Token not sent automatically | Patch `window.fetch` at startup (see Step 7) |

**Scoping loan applications to the creating user** — add this to `LoanApplicationsResource`:

```ts
import type { ListQuery } from '../../core/crud/listQuery.js'

protected override async beforeList(query: ListQuery, ctx: Context): Promise<ListQuery> {
  const user = ctx.get('user') as { id: number; role: string }
  if (user.role === 'admin') return query   // admins see everything
  return {
    ...query,
    filters: [...query.filters, { field: 'created_by', op: 'eq' as const, value: user.id }],
  }
}

protected override async beforeCreate(body: unknown, ctx: Context): Promise<unknown> {
  const user = ctx.get('user') as { id: number }
  return { ...(body as object), created_by: user.id }
}
```
