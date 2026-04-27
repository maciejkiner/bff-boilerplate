import { FormBuilder } from '../../core/form/index.js'
import type { CompanyInsert } from './model.js'

export const companyForm = new FormBuilder<CompanyInsert>()
  .field('name').required().maxLength(100)
  .field('nip').optional().isUnique('companies', 'nip')
  .field('city').optional().maxLength(100)
  .field('street').optional().maxLength(200)
  .field('zip_code').optional().maxLength(10)
  .build()
