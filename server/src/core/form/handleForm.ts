import { ModelBase } from '../model/ModelBase.js'
import type { FormContext, FormDefinition, FormResult, ValidationContext } from './types.js'
import type { PgTableWithColumns } from 'drizzle-orm/pg-core'
import { validateForm } from './validateForm.js'

export async function handleForm<
  TInput extends Record<string, unknown>,
  TTable extends PgTableWithColumns<any>,
  TSelect extends { id: number },
>(
  form: FormDefinition<TInput>,
  model: ModelBase<TTable, TInput, TSelect>,
  payload: unknown,
  id?: number,
  validationContext: ValidationContext = 'submit',
  user?: FormContext<TInput>['user'],
): Promise<FormResult<TSelect>> {
  const result = await validateForm(form, payload, validationContext, { ...(id !== undefined ? { excludeId: id } : {}), ...(user ? { user } : {}) })
  if (!result.ok) return { state: 'error', errors: result.errors }
  const saved = await model.save(result.data, id)
  return { state: id !== undefined ? 'updated' : 'created', data: saved }
}
