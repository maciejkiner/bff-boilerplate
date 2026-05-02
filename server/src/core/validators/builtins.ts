import { validators } from './registry.js'

// ── NIP (Polish tax ID — 10 digits) ──────────────────────────────────────────

function validateNip(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return 'Invalid NIP'
  const digits = String(value).replace(/[- ]/g, '')
  if (!/^\d{10}$/.test(digits)) return 'NIP must be 10 digits'
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7]
  const sum = weights.reduce((acc, w, i) => acc + w * Number(digits[i]), 0)
  if (sum % 11 !== Number(digits[9])) return 'Invalid NIP checksum'
  return null
}

// ── REGON (Polish business registry — 9 or 14 digits) ────────────────────────

function validateRegon(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return 'Invalid REGON'
  const digits = String(value).replace(/\s/g, '')
  if (digits.length === 9) {
    if (!/^\d{9}$/.test(digits)) return 'REGON must be 9 or 14 digits'
    const w9 = [8, 9, 2, 3, 4, 5, 6, 7]
    const sum = w9.reduce((acc, w, i) => acc + w * Number(digits[i]), 0)
    const check = sum % 11 % 10
    if (check !== Number(digits[8])) return 'Invalid REGON checksum'
    return null
  }
  if (digits.length === 14) {
    if (!/^\d{14}$/.test(digits)) return 'REGON must be 9 or 14 digits'
    const w14 = [2, 4, 8, 5, 0, 9, 7, 3, 6, 1, 2, 4, 8]
    const sum  = w14.reduce((acc, w, i) => acc + w * Number(digits[i]), 0)
    const check = sum % 11 % 10
    if (check !== Number(digits[13])) return 'Invalid REGON checksum'
    return null
  }
  return 'REGON must be 9 or 14 digits'
}

// ── PESEL (Polish personal ID — 11 digits) ────────────────────────────────────

function validatePesel(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return 'Invalid PESEL'
  const digits = String(value).replace(/\s/g, '')
  if (!/^\d{11}$/.test(digits)) return 'PESEL must be 11 digits'
  const weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3]
  const sum     = weights.reduce((acc, w, i) => acc + w * Number(digits[i]), 0)
  const check   = (10 - (sum % 10)) % 10
  if (check !== Number(digits[10])) return 'Invalid PESEL checksum'
  return null
}

// ── IBAN (international bank account number) ─────────────────────────────────

function validateIban(value: unknown): string | null {
  if (typeof value !== 'string') return 'Invalid IBAN'
  const normalized = value.replace(/\s/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{1,30}$/.test(normalized)) return 'Invalid IBAN format'
  // Move first 4 chars to end, replace letters with digits (A=10…Z=35)
  const rearranged = (normalized.slice(4) + normalized.slice(0, 4))
    .split('')
    .map(ch => (ch >= 'A' && ch <= 'Z') ? String(ch.charCodeAt(0) - 55) : ch)
    .join('')
  // BigInt mod 97
  let remainder = 0n
  for (const ch of rearranged) {
    remainder = (remainder * 10n + BigInt(ch)) % 97n
  }
  if (remainder !== 1n) return 'Invalid IBAN checksum'
  return null
}

// ── Polish phone number ───────────────────────────────────────────────────────

function validatePhonePl(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return 'Invalid phone number'
  const normalized = String(value).replace(/[\s\-().]/g, '')
  // Accept: +48XXXXXXXXX, 0048XXXXXXXXX, or 9 digits starting with 4-8
  if (/^(\+48|0048)?[4-8]\d{8}$/.test(normalized)) return null
  return 'Invalid Polish phone number'
}

// ── Register all built-ins ────────────────────────────────────────────────────

validators
  .register('nip',      validateNip)
  .register('regon',    validateRegon)
  .register('pesel',    validatePesel)
  .register('iban',     validateIban)
  .register('phone_pl', validatePhonePl)
