/**
 * Example: form validation tests using FormTestKit.
 *
 * These run entirely in-memory — no database, no HTTP.
 */
import { describe, it } from 'vitest'
import { FormTestKit } from '../core/testing/index.js'
import { userForm } from '../resources/users/form.js'
import type { UserInsert } from '../resources/users/model.js'

const valid: UserInsert = {
  email:  'alice@example.com',
  name:   'Alice',
  role:   'user',
  active: true,
}

describe('userForm — field validation', () => {
  it('accepts valid input', () => {
    FormTestKit.fill(userForm, valid).expectValid()
  })

  it('requires email', () => {
    FormTestKit.fill(userForm, { ...valid, email: '' }).expectError('email')
  })

  it('rejects malformed email', () => {
    FormTestKit.fill(userForm, { ...valid, email: 'not-an-email' }).expectError('email')
  })

  it('requires name', () => {
    FormTestKit.fill(userForm, { ...valid, name: '' }).expectError('name')
  })

  it('enforces name maxLength of 100', () => {
    FormTestKit.fill(userForm, { ...valid, name: 'a'.repeat(101) }).expectError('name')
  })

  it('requires role', () => {
    FormTestKit.fill(userForm, { ...valid, role: '' }).expectError('role')
  })

  it('rejects unknown role value', () => {
    FormTestKit.fill(userForm, { ...valid, role: 'superuser' as 'user' }).expectError('role')
  })
})

describe('userForm — field visibility and editability', () => {
  it('all fields visible for default context', () => {
    const runner = FormTestKit.fill(userForm, valid)
    runner
      .expectFieldVisible('email')
      .expectFieldVisible('name')
      .expectFieldVisible('role')
      .expectFieldVisible('active')
  })

  it('all fields editable for default context', () => {
    const runner = FormTestKit.fill(userForm, valid)
    runner
      .expectFieldEditable('email')
      .expectFieldEditable('name')
      .expectFieldEditable('role')
      .expectFieldEditable('active')
  })
})

describe('userForm — role-aware form (example extension)', () => {
  it('admin can see all fields', () => {
    FormTestKit.fill(userForm, valid)
      .withContext({ user: { id: 1, role: 'admin' } })
      .expectFieldVisible('role')
  })
})
