import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { useFormEngine } from './react/useFormEngine.js'
import { FormController } from './react/FormController.js'

// Example user for edit mode — remove useEffect below to test create mode
const existingUser = {
  id:     1,
  email:  'alice@example.com',
  name:   'Alice Smith',
  role:   'user',
  active: true,
}

function App() {
  const { engine, state } = useFormEngine({
    endpoint:  '/users',
    onSuccess: (data, mode) => console.log(`${mode}:`, data),
  })

  // Comment out to test create mode
  useEffect(() => { engine.load(existingUser) }, [engine])

  return (
    <main>
      <h1>{existingUser ? 'Edit User' : 'New User'}</h1>
      {state === 'created' && <p className="success">User created!</p>}
      {state === 'updated' && <p className="success">User updated!</p>}
      <FormController engine={engine} />
    </main>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')
createRoot(root).render(<StrictMode><App /></StrictMode>)
