import { ModelBase } from '../model/ModelBase.js'
import type { FormDefinition, FormResult, ValidationContext } from './types.js'
import type { PgTableWithColumns, TableConfig } from 'drizzle-orm/pg-core'
import { validateForm } from './validateForm.js'

export async function handleForm<
  TInput extends Record<string, unknown>,
  TTable extends PgTableWithColumns<TableConfig>,
  TSelect extends { id: number },
>(
  form: FormDefinition<TInput>,
  model: ModelBase<TTable, TInput, TSelect>,
  payload: unknown,
  id?: number,
  validationContext: ValidationContext = 'submit',
): Promise<FormResult<TSelect>> {
  const result = await validateForm(form, payload, validationContext, id)
  if (!result.ok) return { state: 'error', errors: result.errors }
  const saved = await model.save(result.data, id)
  return { state: id !== undefined ? 'updated' : 'created', data: saved }
}
