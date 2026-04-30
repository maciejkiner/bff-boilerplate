import { defineForm, text } from '../../core/form/index.js'
import type { CompanyInsert } from './model.js'

export const companyForm = defineForm<CompanyInsert>([
  text('name',     { label: 'Company name', required: true, maxLength: 100 }),
  text('nip',      { label: 'NIP',      placeholder: '000-000-00-00', unique: { field: 'nip', table: 'companies', column: 'nip' } }),
  text('city',     { label: 'City',     maxLength: 100 }),
  text('street',   { label: 'Street',   maxLength: 200 }),
  text('zip_code', { label: 'Zip code', placeholder: '00-000', maxLength: 10 }),
])
