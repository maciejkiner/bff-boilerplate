import type { FieldConfig } from '../../core/types.js'

export const companyFields: FieldConfig[] = [
  { name: 'name',     label: 'Company name', type: 'text',  required: true },
  { name: 'nip',      label: 'NIP',          type: 'text',  placeholder: '000-000-00-00' },
  { name: 'city',     label: 'City',         type: 'text' },
  { name: 'street',   label: 'Street',       type: 'text' },
  { name: 'zip_code', label: 'Zip code',     type: 'text',  placeholder: '00-000' },
]
