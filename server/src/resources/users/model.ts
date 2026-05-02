import { users } from '../../db/schema.js'
import { ModelBase } from '../../core/model/ModelBase.js'
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'

export type User       = InferSelectModel<typeof users>
export type UserInsert = InferInsertModel<typeof users>

export class UserModel extends ModelBase<typeof users, UserInsert, User> {
  readonly table = users
}
