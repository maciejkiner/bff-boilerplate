import { FormBuilder } from '../../core/form/index.js'
import type { CompanyInsert } from './model.js'

export const companyForm = new FormBuilder<CompanyInsert>()
  .field('name').label('Company name').required().maxLength(100)
  .field('nip').label('NIP').placeholder('000-000-00-00').optional().isUnique('companies', 'nip')
  .field('city').label('City').optional().maxLength(100)
  .field('street').label('Street').optional().maxLength(200)
  .field('zip_code').label('Zip code').placeholder('00-000').optional().maxLength(10)
  .build()
