import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { useFormEngine } from './react/useFormEngine.js'
import { FormController } from './react/FormController.js'

// Example company for edit mode — remove to test create mode
const existingCompany = {
  id: 1,
  name: 'Acme Ltd.',
  nip: '123-456-78-90',
  city: 'Warsaw',
  street: 'ul. Przykładowa 1',
  zip_code: '00-001',
}

function App() {
  const { engine, state } = useFormEngine({
    endpoint: '/companies',
    onSuccess: (data, mode) => console.log(`${mode}:`, data),
  })

  // Comment out to test create mode
  useEffect(() => { engine.load(existingCompany) }, [engine])

  return (
    <main>
      <h1>{existingCompany ? 'Edit Company' : 'New Company'}</h1>
      {state === 'created' && <p className="success">Company created!</p>}
      {state === 'updated' && <p className="success">Company updated!</p>}
      <FormController engine={engine} />
    </main>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')
createRoot(root).render(<StrictMode><App /></StrictMode>)
